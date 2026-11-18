import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'EchoLab — Create in your own frequency', description: 'A guitar-first recording studio with multitrack editing, live loops and local-first projects.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
