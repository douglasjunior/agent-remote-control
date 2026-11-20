import { Monitor, Moon, Sun } from 'lucide-react';

import { THEME_LABELS, THEMES, useTheme, type Theme } from '../theme/theme-context.js';

import { IconButton } from './icon-button.js';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from './ui/dropdown-menu.js';


const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = ICONS[theme];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<IconButton variant="outline" label="Theme" />}>
        <Icon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={value => setTheme(value as Theme)}>
          {THEMES.map(item => (
            <DropdownMenuRadioItem key={item} value={item}>{THEME_LABELS[item]}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
