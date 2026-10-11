import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from "./chatgpt-auth";
import { RadioApp } from "../components/radio-app";
import { env } from "cloudflare:workers";
export const dynamic="force-dynamic";
export default async function Home(){
 const user=await getChatGPTUser();
 if(!user)return <main className="gate"><div className="gate-card"><div className="brand-mark">◉</div><p className="eyebrow">PRIVATE LISTENING</p><h1>Your own radio, on your terms.</h1><p>Sign in to create and replay your personal audio programs.</p><a className="primary-link" href={chatGPTSignInPath("/")} target="_top">Sign in with ChatGPT</a></div></main>;
 const configured=(env as any).OWNER_CHATGPT_USER_ID||(process.env.NODE_ENV!=="production"?"local_seedy":null);
 if(!configured)return <main className="gate"><div className="gate-card"><div className="brand-mark">◉</div><p className="eyebrow">OWNER SETUP</p><h1>Set your private owner ID</h1><p>Add this Site scoped identity as the <code>OWNER_CHATGPT_USER_ID</code> runtime secret, then reload. The app stays closed until it matches.</p><code className="identity-code">{user.userId}</code></div></main>;
 if(user.userId!==configured)return <main className="gate"><div className="gate-card"><div className="brand-mark">◉</div><h1>Private radio</h1><p>This account does not have access.</p><a href={chatGPTSignOutPath("/")} target="_top">Sign out</a></div></main>;
 return <RadioApp signOutPath={chatGPTSignOutPath("/")} />;
}
