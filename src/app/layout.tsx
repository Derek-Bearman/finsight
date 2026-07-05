import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { FirmAppGate } from '@/components/app/FirmAppGate';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'FinSight — Financial Intelligence for Accounting Firms',
  description:
    'Analyze financial statements, project performance, and run what-if scenarios for SMB clients across any industry.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <FirmAppGate>{children}</FirmAppGate>
      </body>
    </html>
  );
}
