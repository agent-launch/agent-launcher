import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { LoaderCircle, Wifi } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useT } from '@/i18n'
import type { CliId, CliProfilePatch, ProfileConnectionResult } from '@shared/types'

export function ProfileConnectionTest({
  cliId,
  profile
}: {
  cliId: CliId
  profile: CliProfilePatch
}) {
  const t = useT()
  const [testing, setTesting] = useState(false)
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
  }, [signature])

  const showResult = (result: ProfileConnectionResult) => {
    const message = `${t(`config.connection.${result.code}`)}${result.detail ? ` - ${result.detail}` : ''}`
    if (result.ok) toast.success(message)
    else toast.error(message)
  }

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
    try {
      const next = await window.api.config.testConnection(cliId, profile)
      if (requestRef.current === requestId) {
        showResult(
          next.kind === 'generation'
            ? next
            : { kind: 'generation', ok: false, code: 'backend_mismatch' }
        )
      }
    } catch {
      if (requestRef.current === requestId) {
        showResult({ kind: 'generation', ok: false, code: 'network_error' })
      }
    } finally {
      if (requestRef.current === requestId) setTesting(false)
    }
  }

  return (
    <Button size="sm" variant="secondary" onClick={test} disabled={testing}>
      {testing ? <LoaderCircle className="animate-spin" size={13} /> : <Wifi size={13} />}
      {testing ? t('config.connection.testing') : t('config.connection.test')}
    </Button>
  )
}
