import { handleUser } from "../../../lib/api-user";
import { handleInternal } from "../../../lib/api-internal";
import { ApiError, fail } from "../../../lib/radio";
export const runtime="edge";
async function dispatch(request:Request,context:{params:Promise<{path:string[]}>}){
 const {path}=await context.params;
 try{
  return path[0]==="internal"?await handleInternal(request,path.slice(1)):await handleUser(request,path);
 }catch(error){
  if(error instanceof ApiError)return fail(error.code,error.message,error.status,error.retryable);
  if(process.env.NODE_ENV!=="production")console.error("API error:",error instanceof Error?error.message:"unknown");
  return fail("internal_error","An unexpected server error occurred",500,true);
 }
}
export {dispatch as GET,dispatch as HEAD,dispatch as POST,dispatch as PUT,dispatch as PATCH,dispatch as DELETE};
