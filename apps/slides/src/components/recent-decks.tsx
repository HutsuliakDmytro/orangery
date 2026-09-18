import { RecentFilesMenu } from '@orangery/ui-kit'
import { openRecent, useRecentDecks } from '../document/recent'

/** File → Open Recent, in the header, where it is reachable with a deck open. */
export function RecentDecks() {
  return <RecentFilesMenu files={useRecentDecks()} onPick={openRecent} />
}
