import mysql from 'mysql2/promise';
import 'dotenv/config';
export const db = mysql.createPool(process.env.DATABASE_URL || 'mysql://root:password@localhost:3306/adaptivelearn');
export async function tx<T>(fn:(c:mysql.PoolConnection)=>Promise<T>) { const c=await db.getConnection(); try { await c.beginTransaction(); const out=await fn(c); await c.commit(); return out; } catch(e) { await c.rollback(); throw e; } finally { c.release(); } }
