ssh -fN -L 8001:localhost:8001 legal-1

cd backend
uvicorn main:app --host 0.0.0.0 --port 7860
uvicorn main:app --host 0.0.0.0 --port 7860 --reload

curl http://localhost:8001/v1/models
