"use client";

import { MainLayout } from "@/components/ui/layout/MainLayout";

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MainLayout>{children}</MainLayout>;
}
