import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resume Keyword Check",
  description: "See which job-description keywords your resume is missing and which bullet points need work.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
