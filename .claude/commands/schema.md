Show column definitions for a DB table.

Usage: /schema <tableName>

Run:
cd "/Users/north/Documents/[01] Project/โรงเรียนภูพระบาทวิทยา/โครงการ/web PSSMS"
node -e "require('dotenv').config(); require('./lib/db').query(\`SELECT column_name,data_type,character_maximum_length,column_default,is_nullable FROM information_schema.columns WHERE table_name='$1' ORDER BY ordinal_position\`).then(r=>{console.table(r.rows);process.exit()})"

Replace $1 with the table name from the argument. Display results as a table.
