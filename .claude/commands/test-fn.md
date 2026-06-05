Test a backend function endpoint with an admin JWT.

Usage: /test-fn <fnName> [arg1] [arg2] ...

Steps:
1. Read JWT_SECRET from .env in the web PSSMS directory
2. Build and run a Node.js one-liner that:
   - Signs a JWT: `{ id: 'admin', role: 'ADMIN' }`
   - POSTs to `http://localhost:3000/api/gas/<fnName>` with body `{ args: [arg1, arg2, ...] }`
   - Prints the full response JSON
3. If `__error` in response, highlight it clearly
