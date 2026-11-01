import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth } from "@/auth";
import { NotesHome } from "@/components/NotesHome";

export default async function NotesPage() {
  if (!(await auth())?.user) redirect("/");
  return (
    <Suspense>
      <NotesHome />
    </Suspense>
  );
}
