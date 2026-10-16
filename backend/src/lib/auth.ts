import type { NextFunction, Request, Response } from 'express'; import jwt from 'jsonwebtoken'; import {ApiError} from './errors.js';
export type UserRole='student'|'trainer'; export type AuthUser={id:string;role:UserRole;email:string;fullName:string};
const access=()=>process.env.JWT_ACCESS_SECRET || 'development-access-secret-change-me-please';
export function signAccess(u:AuthUser){return jwt.sign(u,access(),{expiresIn:'15m'});}
export function setAccess(res:Response,u:AuthUser){res.cookie('al_access',signAccess(u),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:15*60*1000,path:'/'});}
export function requireAuth(req:Request,_res:Response,next:NextFunction){try{const token=req.cookies.al_access; if(!token) throw 0; req.user=jwt.verify(token,access()) as AuthUser; next();}catch{next(new ApiError(401,'Authentication required. Please log in.'));}}
export function requireRole(...roles:UserRole[]){return (req:Request,_res:Response,next:NextFunction)=> roles.includes(req.user!.role)?next():next(new ApiError(403,'You do not have permission to access this resource.'));}
declare global {namespace Express {interface Request {user?:AuthUser}}}
