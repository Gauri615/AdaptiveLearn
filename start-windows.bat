@echo off
setlocal
cd /d "%~dp0"
echo ADAPTIX AI - XAMPP MySQL prototype
if not exist "backend\.env" (
  copy "backend\.env.example" "backend\.env" >nul
  echo Created backend\.env from example. Edit it if your MySQL credentials differ.
)
echo.
echo Make sure MySQL is running in XAMPP and import backend\sql\schema.sql, then migrations\001_java_assessment.sql and 002_contests_discussions.sql.
echo Java execution also requires Docker Desktop, its Linux engine, and the ADAPTIX sandbox image.
echo If you have not seeded demo data yet, run: npm run seed
echo Starting frontend and backend...
npm run dev
endlocal
