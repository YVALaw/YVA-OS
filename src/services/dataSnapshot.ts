import type { DataSnapshot } from '../data/types'
import { loadSnapshot } from './storage'

export async function getAllDataSnapshot(): Promise<DataSnapshot> {
  return loadSnapshot()
}
