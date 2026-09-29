"""Garante que a raiz do projeto esteja no sys.path ao rodar os testes."""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
