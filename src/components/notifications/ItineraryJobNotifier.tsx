'use client'

import { useEffect, useId, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/contexts/ToastContext'
import { queryClient } from '@/lib/query/queryClient'
import { queryKeys } from '@/lib/query/queryKeys'
import type { QueueJob } from '@/lib/jobs/types'

export function ItineraryJobNotifier() {
  const { showToast } = useToast()
  const [userId, setUserId] = useState<string | null>(null)
  // Unique per instance — realtime-js dedupes channels by topic, so a second
  // mount with the same userId would share an already-subscribed channel and
  // the .on('postgres_changes') would throw.
  const instanceId = useId().replace(/[^a-zA-Z0-9]/g, '')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUserId(session?.user?.id ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userId) return

    const supabase = createClient()
    const statusByJobId = new Map<string, QueueJob['status']>()

    supabase
      .from('jobs')
      .select('id, status')
      .eq('user_id', userId)
      .eq('type', 'itinerary-planning')
      .in('status', ['queued', 'pending', 'processing'])
      .then(({ data }) => {
        data?.forEach((j) => statusByJobId.set(j.id as string, j.status as QueueJob['status']))
      })

    const channel = supabase
      .channel(`itinerary_job_notifier_${userId}_${instanceId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'jobs', filter: `user_id=eq.${userId}` },
        (payload) => {
          const job = payload.new as QueueJob
          if (job.type !== 'itinerary-planning') return

          const prev = statusByJobId.get(job.id)
          statusByJobId.set(job.id, job.status)

          const invalidateItineraryCaches = () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.itineraries() })
            queryClient.invalidateQueries({ queryKey: queryKeys.upcomingItineraries(userId) })
            queryClient.invalidateQueries({ queryKey: queryKeys.itineraryUsage(userId) })
          }

          if (job.status === 'completed' && prev !== 'completed') {
            const result = (job.result ?? {}) as Record<string, unknown>
            if (result.is_rejected) return
            const itineraryId = result.itinerary_id as string | undefined
            invalidateItineraryCaches()
            showToast({
              title: 'Itinerary ready',
              variant: 'success',
              action: itineraryId
                ? { label: 'View', href: `/itineraries/${itineraryId}` }
                : undefined,
            })
          } else if (job.status === 'failed' && prev !== 'failed') {
            invalidateItineraryCaches()
            showToast({
              title: 'We couldn’t generate your itinerary',
              description: 'Please try again in a moment.',
              variant: 'error',
            })
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId, showToast, instanceId])

  return null
}
