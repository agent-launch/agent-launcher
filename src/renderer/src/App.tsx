import { Titlebar } from '@/components/Titlebar'
import { Onboarding } from '@/components/onboarding/Onboarding'
import { Shell } from '@/components/shell/Shell'
import { useAppStore } from '@/store/app'
import { useTheme } from '@/theme'

export default function App() {
  const onboarded = useAppStore((s) => s.onboarded)
  useTheme()

  return (
    <div className="flex h-full flex-col">
      <Titlebar />
      <div className="min-h-0 flex-1">{onboarded ? <Shell /> : <Onboarding />}</div>
    </div>
  )
}
