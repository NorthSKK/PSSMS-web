Kill any process on port 3000, then start the PSSMS web server fresh.

Steps:
1. Run: `kill $(lsof -ti :3000) 2>/dev/null; echo "killed"`
2. Run server in background: `cd "/Users/north/Documents/[01] Project/โรงเรียนภูพระบาทวิทยา/โครงการ/web PSSMS" && node server.js &`
3. Wait ~2 seconds, confirm with `lsof -ti :3000`
4. Report PID and "server ready at http://localhost:3000"
