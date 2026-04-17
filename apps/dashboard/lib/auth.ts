import { redirect } from "next/navigation";

import { getAccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/signin");
  }

  const access = await getAccessContext(user);

  if (!access.isAuthorized) {
    redirect("/unauthorized");
  }

  return { supabase, user, access };
}

export async function getOptionalUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}
