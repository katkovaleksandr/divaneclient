Divane Client Website
=====================

Site: divaneclient.fun
Stack: static React frontend + Node.js Express API

Quick start (local)
-------------------
1. cd server
2. npm install
3. npm start
4. Open http://localhost:3000

Registration / login
--------------------
- Register on the website (auth modal)
- Or register in Divane Launcher (login screen -> Registration)
- Same account works on site and launcher

Launcher sync with website
--------------------------
1. Log in on https://divaneclient.fun (or localhost:3000)
2. Open /launcher-auth.html
3. Page sends session to launcher via divane://auth?token=...
4. Or in launcher click "Voyti cherez sayt"

Production deploy
-----------------
- Point divaneclient.fun to this folder
- Run server with PORT=80 or reverse proxy nginx -> :3000
- Set JWT_SECRET env variable

API endpoints
-------------
POST /api/auth/register
POST /api/auth/login
GET  /api/user/profile
POST /api/launcher/bind-hwid

Data stored in server/data/users.json
