import { BookOpenText, Ellipsis, Settings } from 'lucide-react';
import { Link, useLocation } from 'react-router';

import { THEME_LABELS, THEMES, useTheme, type Theme } from '../theme/theme-context.js';

import { IconButton } from './icon-button.js';
import { SETTINGS_PATH, settingsState } from './server-settings/settings-paths.js';
import { skillsPath, skillsState } from './skills/skill-paths.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.js';


/** The header's secondary links and the theme in one menu, for the screens too narrow to show them side by side. */
export function HeaderMenu({ className }: { readonly className?: string }) {
  const location = useLocation();
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<IconButton variant="ghost" label="More" className={className} />}>
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem render={<Link to={skillsPath()} state={skillsState(location)} />}>
          <BookOpenText />
          Skills
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link to={SETTINGS_PATH} state={settingsState(location)} />}>
          <Settings />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={value => setTheme(value as Theme)}>
            {THEMES.map(item => (
              <DropdownMenuRadioItem key={item} value={item}>{THEME_LABELS[item]}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
