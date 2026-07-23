import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { CircleAlert, CircleCheck, LoaderCircle, Wifi } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useT } from '@/i18n'
import type {
  CliId,
  CliProfilePatch,
  ProfileConnectionResult
} from '@shared/types'

export function ProfileConnectionTest({
  cliId,
  profile
}: {
  cliId: CliId
  profile: CliProfilePatch
}) {
  const t = useT()
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<ProfileConnectionResult | null>(null)
  const requestRef = useRef(0)
  const signature = JSON.stringify([
    cliId,
    profile.baseUrl?.trim(),
    profile.apiKey?.trim(),
    profile.model?.trim(),
    profile.defaultModel?.trim()
  ])

  useEffect(() => {
    requestRef.current += 1
    setTesting(false)
    setResult(null)
  }, [signature])

  const test = async () => {
    if (!profile.baseUrl?.trim()) {
      toast.error(t('config.baseUrlRequiredToast'))
      return
    }
    if (!profile.apiKey?.trim()) {
      toast.error(t('config.apiKeyRequiredToast'))
      return
    }
    const model = cliId === 'claude-code' ? profile.defaultModel || profile.model : profile.model
    if (!model?.trim()) {
      toast.error(t('config.modelRequiredToast'))
      return
    }

    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setTesting(true)
    setResult(null)
    try {
      const next = await window.api.config.testConnection(cliId, profile)
      if (requestRef.current === requestId) {
        setResult(next.kind === 'generation'
          ? next
          : { kind: 'generation', ok: false, code: 'backend_mismatch' })
      }
    } catch {
      if (requestRef.current === requestId) {
        setResult({ kind: 'generation', ok: false, code: 'network_error' })
      }
    } finally {
      if (requestRef.current === requestId) setTesting(false)
    }
  }

  const displayedResult: ProfileConnectionResult | null = result && result.kind !== 'generation'
    ? { kind: 'generation', ok: false, code: 'backend_mismatch' }
    : result
  const warning = displayedResult?.code === 'unsupported_api' || displayedResult?.code === 'backend_mismatch'
  const color = displayedResult?.ok
    ? 'var(--success)'
    : warning
      ? 'var(--warning)'
      : 'var(--danger)'

  return (
    <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <Button size="sm" variant="secondary" onClick={test} disabled={testing}>
        {testing ? <LoaderCircle className="animate-spin" size={13} /> : <Wifi size={13} />}
        {testing ? t('config.connection.testing') : t('config.connection.test')}
      </Button>
      <span className="text-[11px] text-text-weak">{t('config.connection.costNotice')}</span>
      {displayedResult && (
        <span className="flex min-w-0 items-center gap-1 text-[12px]" style={{ color }}>
          {displayedResult.ok ? <CircleCheck className="shrink-0" size={13} /> : <CircleAlert className="shrink-0" size={13} />}
          <span className="break-words">
            {t(`config.connection.${displayedResult.code}`)}
            {displayedResult.detail ? ` — ${displayedResult.detail}` : ''}
          </span>
        </span>
      )}
    </div>
  )
}
