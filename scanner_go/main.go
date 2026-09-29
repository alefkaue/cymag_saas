package main

/*
cymag_scan — Scanner de portas TCP em Go para o CYMAG Enterprise.

Vantagens sobre o socket scan Python:
  - Goroutines (muito mais leve que threads OS)
  - Banner grabbing nativo com probes por protocolo
  - Compila para binário único sem dependências
  - 200+ workers concorrentes sem overhead de GIL

Uso:
  ./cymag_scan -host 192.168.1.1 -timeout 1500 -workers 200
  ./cymag_scan -host 10.0.0.1 -ports "22,80,443,8080-8090"

Output: JSON para stdout → consumido pelo scanner.py via subprocess
*/

import (
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ─── TIPOS ───────────────────────────────────────────────────────────────────

type PortResult struct {
	Port    int    `json:"port"`
	State   string `json:"state"`
	Banner  string `json:"banner,omitempty"`
	Service string `json:"service,omitempty"`
}

type ScanResult struct {
	Host    string       `json:"host"`
	Ports   []PortResult `json:"ports"`
	Elapsed float64      `json:"elapsed_seconds"`
	Total   int          `json:"total_scanned"`
}

// ─── BANCO DE SERVIÇOS ───────────────────────────────────────────────────────

var serviceNames = map[int]string{
	21:    "ftp",
	22:    "ssh",
	23:    "telnet",
	25:    "smtp",
	53:    "dns",
	80:    "http",
	110:   "pop3",
	135:   "msrpc",
	139:   "netbios-ssn",
	143:   "imap",
	443:   "https",
	445:   "smb",
	993:   "imaps",
	995:   "pop3s",
	1099:  "rmiregistry",
	1433:  "mssql",
	1880:  "node-red",
	1883:  "mqtt",
	2049:  "nfs",
	3306:  "mysql",
	3307:  "mysql-alt",
	3389:  "rdp",
	5432:  "postgresql",
	5900:  "vnc",
	5985:  "winrm-http",
	5986:  "winrm-https",
	6379:  "redis",
	8080:  "http-proxy",
	8443:  "https-alt",
	8883:  "mqtt-tls",
	9001:  "mqtt-ws",
	9200:  "elasticsearch",
	11211: "memcached",
	27017: "mongodb",
}

// ─── PROBES POR PROTOCOLO ────────────────────────────────────────────────────
// Enviadas quando a porta não envia banner passivo

var activeProbes = map[int][]byte{
	// HTTP HEAD genérico
	80:   []byte("HEAD / HTTP/1.0\r\nHost: localhost\r\nUser-Agent: cymag-scan/2.0\r\n\r\n"),
	8080: []byte("HEAD / HTTP/1.0\r\nHost: localhost\r\nUser-Agent: cymag-scan/2.0\r\n\r\n"),
	8443: []byte("HEAD / HTTP/1.0\r\nHost: localhost\r\nUser-Agent: cymag-scan/2.0\r\n\r\n"),
	// Node-RED settings
	1880: []byte("GET /settings HTTP/1.0\r\nHost: localhost\r\n\r\n"),
	// Redis PING
	6379: []byte("PING\r\n"),
	// Memcached stats
	11211: []byte("stats\r\n"),
	// MySQL greeting (esperar passivo)
	3306: nil,
	// SMTP EHLO
	25: []byte("EHLO cymag.probe\r\n"),
}

// ─── BANNER GRAB ─────────────────────────────────────────────────────────────

func grabBanner(host string, port int, timeout time.Duration) string {
	addr := fmt.Sprintf("%s:%d", host, port)
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return ""
	}
	defer conn.Close()

	buf := make([]byte, 1024)

	// 1. Tentar ler banner passivo (SSH, FTP, Redis, MySQL, SMTP enviam primeiro)
	conn.SetReadDeadline(time.Now().Add(timeout / 2))
	n, _ := conn.Read(buf)
	if n > 0 {
		return cleanBanner(string(buf[:n]))
	}

	// 2. Enviar probe ativo se disponível
	if probe, ok := activeProbes[port]; ok && probe != nil {
		conn.SetWriteDeadline(time.Now().Add(timeout / 2))
		conn.Write(probe)
		conn.SetReadDeadline(time.Now().Add(timeout / 2))
		n, _ = conn.Read(buf)
		if n > 0 {
			return cleanBanner(string(buf[:n]))
		}
	}

	return ""
}

func cleanBanner(raw string) string {
	// Remover caracteres de controle, manter printable
	var sb strings.Builder
	for _, r := range raw {
		if r == '\n' || r == '\r' || r == '\t' || (r >= 32 && r < 127) {
			sb.WriteRune(r)
		}
	}
	result := strings.TrimSpace(sb.String())
	// Limitar tamanho
	if len(result) > 512 {
		result = result[:512] + "..."
	}
	return result
}

// ─── CHECK DE PORTA ───────────────────────────────────────────────────────────

func checkPort(host string, port int, timeout time.Duration) PortResult {
	result := PortResult{
		Port:    port,
		State:   "closed",
		Service: serviceNames[port],
	}

	addr := fmt.Sprintf("%s:%d", host, port)
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return result
	}
	conn.Close()

	result.State  = "open"
	result.Banner = grabBanner(host, port, timeout)
	return result
}

// ─── PARSER DE PORTAS ─────────────────────────────────────────────────────────

func parsePorts(raw string) []int {
	var ports []int
	seen := make(map[int]bool)

	for _, token := range strings.Split(raw, ",") {
		token = strings.TrimSpace(token)
		if token == "" {
			continue
		}
		if strings.Contains(token, "-") {
			parts := strings.SplitN(token, "-", 2)
			start, e1 := strconv.Atoi(parts[0])
			end, e2   := strconv.Atoi(parts[1])
			if e1 == nil && e2 == nil && start <= end {
				for i := start; i <= end && i <= 65535; i++ {
					if !seen[i] {
						ports = append(ports, i)
						seen[i] = true
					}
				}
			}
		} else {
			n, err := strconv.Atoi(token)
			if err == nil && n > 0 && n <= 65535 && !seen[n] {
				ports = append(ports, n)
				seen[n] = true
			}
		}
	}
	return ports
}

// ─── PORTAS PADRÃO ────────────────────────────────────────────────────────────

const defaultPorts = "21,22,23,25,53,80,110,135,139,143,443,445,993,995," +
	"1099,1433,1880,1883,2049,3306,3307,3389,5432,5900," +
	"5985,5986,6379,8080,8443,8883,9001,9200,11211,27017"

// ─── MAIN ─────────────────────────────────────────────────────────────────────

func main() {
	host      := flag.String("host",    "",           "Alvo: IP ou hostname")
	portsFlag := flag.String("ports",   defaultPorts, "Portas: 80,443 ou range 1-1024")
	timeoutMs := flag.Int("timeout",    1500,         "Timeout por porta (ms)")
	workers   := flag.Int("workers",    200,          "Goroutines concorrentes")
	flag.Parse()

	if *host == "" {
		fmt.Fprintln(os.Stderr, "Uso: cymag_scan -host <alvo> [-ports ...] [-timeout ms] [-workers N]")
		os.Exit(1)
	}

	ports   := parsePorts(*portsFlag)
	timeout := time.Duration(*timeoutMs) * time.Millisecond
	start   := time.Now()

	// Semáforo para limitar concorrência
	sem := make(chan struct{}, *workers)

	var (
		mu        sync.Mutex
		wg        sync.WaitGroup
		openPorts []PortResult
	)

	for _, port := range ports {
		wg.Add(1)
		sem <- struct{}{}

		go func(p int) {
			defer wg.Done()
			defer func() { <-sem }()

			r := checkPort(*host, p, timeout)
			if r.State == "open" {
				mu.Lock()
				openPorts = append(openPorts, r)
				mu.Unlock()
			}
		}(port)
	}

	wg.Wait()

	// Ordenar por porta
	sort.Slice(openPorts, func(i, j int) bool {
		return openPorts[i].Port < openPorts[j].Port
	})

	result := ScanResult{
		Host:    *host,
		Ports:   openPorts,
		Elapsed: time.Since(start).Seconds(),
		Total:   len(ports),
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(result); err != nil {
		fmt.Fprintf(os.Stderr, "Erro ao serializar JSON: %v\n", err)
		os.Exit(1)
	}
}
