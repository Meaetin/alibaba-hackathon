"use client";

import { type ReactNode } from "react";
import { CreditCard, LogOut, Settings, User } from "lucide-react";
import { useRouter } from "next/navigation";

import { signOut } from "@/lib/api/auth";
import { queryClient } from "@/lib/query/queryClient";
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
    await signOut();
    // The session query is cached across the app, so clearing it is what makes
    // every component re-read "signed out" instead of the user it saw a moment
    // ago. Without this the navbar still shows an avatar on the login page.
    queryClient.clear();
    router.push("/login");
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
          leadingIcon={<User className="size-4" />}
          onClick={() => router.push("/profile")}
        >
          Profile
        </MenuItem>
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
