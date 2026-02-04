(define-constant ERR_ALREADY_CLAIMED u100)
(define-constant ERR_BADGE_ALREADY_MINTED u101)

(define-constant BLOCKS_PER_DAY u144)
(define-constant BADGE_STREAK u7)

(define-map last-claim-day principal uint)
(define-map streak principal uint)
(define-map badge-claimed principal bool)

(define-data-var next-token-id uint u1)
(define-non-fungible-token badge uint)

(define-read-only (get-current-day)
  (/ stacks-block-height BLOCKS_PER_DAY)
)

(define-read-only (get-streak (user principal))
  (default-to u0 (map-get? streak user))
)

(define-read-only (get-last-claim-day (user principal))
  (default-to u0 (map-get? last-claim-day user))
)

(define-read-only (has-badge (user principal))
  (default-to false (map-get? badge-claimed user))
)

(define-private (mint-badge (user principal))
  (let ((already (default-to false (map-get? badge-claimed user))))
    (if already
        (err ERR_BADGE_ALREADY_MINTED)
        (let ((token-id (var-get next-token-id)))
          (var-set next-token-id (+ token-id u1))
          (map-set badge-claimed user true)
          (match (nft-mint? badge token-id user)
            minted (ok (some token-id))
            err-code (err err-code)
          )
        )
    )
  )
)

(define-public (claim)
  (let (
        (current-day (get-current-day))
        (last-day-opt (map-get? last-claim-day tx-sender))
        (current-streak (default-to u0 (map-get? streak tx-sender)))
       )
    (match last-day-opt last-day
      (if (is-eq current-day last-day)
          (err ERR_ALREADY_CLAIMED)
          (let (
                (new-streak (if (is-eq (+ last-day u1) current-day)
                                (+ current-streak u1)
                                u1))
               )
            (map-set last-claim-day tx-sender current-day)
            (map-set streak tx-sender new-streak)
            (let ((badge-result (if (is-eq new-streak BADGE_STREAK)
                                    (mint-badge tx-sender)
                                    (ok none))))
              (match badge-result
                token-id
                (ok {
                  streak: new-streak,
                  day: current-day,
                  badge-minted: (is-some token-id),
                  token-id: token-id
                })
                err-code
                (if (is-eq err-code ERR_BADGE_ALREADY_MINTED)
                    (ok {
                      streak: new-streak,
                      day: current-day,
                      badge-minted: false,
                      token-id: none
                    })
                    (err err-code))
              )
            )
          )
      )
      (let ((new-streak u1))
        (map-set last-claim-day tx-sender current-day)
        (map-set streak tx-sender new-streak)
        (let ((badge-result (if (is-eq new-streak BADGE_STREAK)
                                (mint-badge tx-sender)
                                (ok none))))
          (match badge-result
            token-id
            (ok {
              streak: new-streak,
              day: current-day,
              badge-minted: (is-some token-id),
              token-id: token-id
            })
            err-code
            (if (is-eq err-code ERR_BADGE_ALREADY_MINTED)
                (ok {
                  streak: new-streak,
                  day: current-day,
                  badge-minted: false,
                  token-id: none
                })
                (err err-code))
          )
        )
      )
    )
  )
)
