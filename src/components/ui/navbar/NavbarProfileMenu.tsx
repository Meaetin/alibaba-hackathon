"use client";

import { type ReactNode } from "react";
import { CreditCard, LogOut, Settings, User } from "lucide-react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/primitives/Button";
import {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MenuSeparator,
} from "@/components/ui/primitives/Menu";

interface NavbarProfileMenuProps {
  avatar?: ReactNode;
}

function NavbarProfileMenu({ avatar }: NavbarProfileMenuProps) {
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/home");
  };

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button variant="ghost" size="md" icon="only" />
        }
        aria-label="Profile"
      >
        {avatar ?? <User className="size-4" />}
      </MenuTrigger>

      <MenuContent align="end" sideOffset={8} positionerClassName="z-50">
        <MenuItem
          icon="leading"
          leadingIcon={<Settings className="size-4" />}
          onClick={() => router.push("/settings")}
        >
          Settings
        </MenuItem>
        <MenuItem
          icon="leading"
          leadingIcon={<CreditCard className="size-4" />}
          onClick={() => router.push("/billing")}
        >
          Plan &amp; billing
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon="leading"
          leadingIcon={<LogOut className="size-4" />}
          onClick={handleSignOut}
        >
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export { NavbarProfileMenu };
export type { NavbarProfileMenuProps };
