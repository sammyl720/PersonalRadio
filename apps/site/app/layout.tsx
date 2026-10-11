import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"Personal Radio",description:"Private audio programs made for one listener",manifest:"/manifest.webmanifest",icons:{icon:"/favicon.svg",apple:"/favicon.svg"},appleWebApp:{capable:true,title:"Personal Radio",statusBarStyle:"black-translucent"}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><meta name="theme-color" content="#0b111b"/><body>{children}</body></html>}
