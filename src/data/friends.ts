import type { FriendShare } from '@/domain/friends'

const STORAGE_KEY = 'solar-statistik-friends-v1'

export function loadFriends(): FriendShare[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isFriend)
  } catch {
    return []
  }
}

function isFriend(v: unknown): v is FriendShare {
  if (!v || typeof v !== 'object') return false
  const o = v as FriendShare
  if (typeof o.id !== 'string' || typeof o.name !== 'string' || !Array.isArray(o.months)) {
    return false
  }
  if (o.days != null && !Array.isArray(o.days)) return false
  return true
}

export function saveFriends(rows: FriendShare[]): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
}
