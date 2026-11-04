import { Monitor, Moon, Sun } from 'lucide-react';

import { THEMES, useTheme, type Theme } from '../theme/theme-context.js';

import { Button } from './ui/button.js';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from './ui/dropdown-menu.js';


const LABELS: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' };
const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = ICONS[theme];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Theme" />}>
        <Icon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={value => setTheme(value as Theme)}>
          {THEMES.map(item => (
            <DropdownMenuRadioItem key={item} value={item}>{LABELS[item]}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
