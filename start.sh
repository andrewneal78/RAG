#!/bin/bash

# Start both frontend and backend servers

echo "Starting backend server..."
cd server
npm run dev &
BACKEND_PID=$!
cd ..

echo "Waiting for backend to start..."
sleep 3

echo "Starting frontend server..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo "=========================================="
echo "Both servers are starting!"
echo "Frontend: http://localhost:3000"
echo "Backend: http://localhost:3001"
echo "=========================================="
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID
