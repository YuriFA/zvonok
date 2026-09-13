import { MoonIcon, SunIcon, Palette } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  colorThemes,
  modes,
  applyTheme,
  getInitialTheme,
  type ColorTheme,
  type Mode,
} from "@/lib/config/themes";

export function ThemeSwitcher() {
  // The stored theme seeds the first render; applying to the document is the
  // only side effect and stays in sync with this single state object.
  const [theme, setTheme] = useState(() => getInitialTheme());

  useEffect(() => {
    applyTheme(theme.color, theme.mode);
  }, [theme]);

  const handleColorChange = (newColor: ColorTheme) => {
    setTheme((prev) => ({ ...prev, color: newColor }));
  };

  const handleModeChange = (newMode: Mode) => {
    setTheme((prev) => ({ ...prev, mode: newMode }));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(props) => (
          <Button variant="outline" size="icon" {...props}>
            <Palette className="size-4" />
          </Button>
        )}
      />
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Accent Color</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme.color}
            onValueChange={(v) => handleColorChange(v as ColorTheme)}
          >
            {colorThemes.map((colorTheme) => (
              <DropdownMenuRadioItem key={colorTheme.id} value={colorTheme.id}>
                <span
                  className="mr-2 inline-block size-3 rounded-full border border-border"
                  style={{ backgroundColor: colorTheme.color }}
                />
                {colorTheme.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Mode</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={theme.mode}
            onValueChange={(v) => handleModeChange(v as Mode)}
          >
            {modes.map((m) => (
              <DropdownMenuRadioItem key={m.id} value={m.id}>
                {m.id === "light" ? (
                  <SunIcon className="mr-2 size-4" />
                ) : (
                  <MoonIcon className="mr-2 size-4" />
                )}
                {m.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
