'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Filters } from '@/components/history/Filters'
import { Timeline } from '@/components/history/Timeline'
import { fetchEvents } from '@/lib/api'

const PAGE_SIZE = 50

export default function HistoryPage() {
  const [source, setSource] = useState('all')
  const [page, setPage] = useState(1)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['events', source, page],
    queryFn: () =>
      fetchEvents({
        source: source !== 'all' ? source : undefined,
        page,
        limit: PAGE_SIZE,
      }),
  })

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0

  function handleSourceChange(value: string) {
    setSource(value)
    setPage(1)
  }

  return (
    <main className="min-h-screen bg-background p-6 max-w-3xl mx-auto">
      <header className="mb-6 flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Dashboard
          </Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold">Historique</h1>
          {data && (
            <p className="text-sm text-muted-foreground">{data.total} événements</p>
          )}
        </div>
      </header>

      <div className="mb-4">
        <Filters
          source={source}
          onSourceChange={handleSourceChange}
          onReset={() => handleSourceChange('all')}
        />
      </div>

      {isLoading && <p className="text-muted-foreground text-sm">Chargement...</p>}
      {isError && <p className="text-destructive text-sm">Erreur de chargement</p>}
      {data && <Timeline events={data.data} />}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </main>
  )
}
