ssh -N \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=999 \
  -L 8000:localhost:8000 \
  -L 8001:localhost:8001 \
  eb

