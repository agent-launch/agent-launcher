import { BarChart3, Info, Settings2, type LucideIcon } from 'lucide-react'

export type SettingsTab = 'general' | 'usage' | 'about'

export const SETTINGS_TABS: { id: SettingsTab; icon: LucideIcon; labelKey: string }[] = [
  { id: 'general', icon: Settings2, labelKey: 'settings.tabGeneral' },
  { id: 'usage', icon: BarChart3, labelKey: 'settings.tabUsage' },
  { id: 'about', icon: Info, labelKey: 'settings.tabAbout' }
]
