export const LEAGUE_RULES = {
  provider: 'FanDuel', jurisdiction: 'Connecticut', version: '2026-07-30',
  url: 'https://d38ayms4az88sz.cloudfront.net/SB/CT/2026-07-30T12-42-48.html',
};

export function createReview(bet, actor, reason, at) {
  if (bet.uid !== actor) throw Error('You can only flag your own bet.');
  if (!['won', 'lost'].includes(bet.status)) throw Error('Only a posted win or loss can be flagged.');
  if (typeof reason !== 'string' || reason.trim().length < 3 || reason.trim().length > 500)
    throw Error('Explain the discrepancy in 3–500 characters.');
  if (bet.review?.status === 'open') throw Error('This bet already awaits commissioner review.');
  if (bet.review?.settledAt === bet.settledAt && bet.review?.status === 'resolved')
    throw Error('The commissioner already reviewed this result.');
  return { status: 'open', reason: reason.trim(), requestedBy: actor, requestedAt: at, settledAt: bet.settledAt ?? null, result: bet.status };
}
