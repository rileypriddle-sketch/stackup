;; StackUp Streak V2
;;
;; - Daily claim tracking (deterministic day from block height)
;; - Multiple milestone NFT badges
;; - Token URIs via a local SIP-009 trait
;;
;; Notes:
;; - This is a new contract (immutable once deployed). Deploy as `streak-v2`.
;; - Set CONTRACT_OWNER to the deploying principal before mainnet deployment.

(impl-trait .sip009-nft-trait.sip009-nft-trait)

(define-constant CONTRACT_OWNER 'SP2022VXQ3E384AAHQ15KFFXVN3CY5G57HWCCQX23)

(define-constant ERR_ALREADY_CLAIMED u100)
(define-constant ERR_NOT_OWNER u101)
(define-constant ERR_BADGE_ALREADY_MINTED u102)
(define-constant ERR_NOT_TOKEN_OWNER u103)
(define-constant ERR_BADGE_NOT_CONFIGURED u104)
(define-constant ERR_STREAK_TOO_LOW u105)

(define-constant BLOCKS_PER_DAY u144)

;; Fixed milestones (can be expanded in a future version).
(define-constant BADGE_KIND_3 u3)
(define-constant BADGE_KIND_7 u7)
(define-constant BADGE_KIND_14 u14)
(define-constant BADGE_KIND_30 u30)

(define-map last-claim-day principal uint)
(define-map streak principal uint)

;; Milestone bookkeeping
(define-map badge-claimed (tuple (user principal) (kind uint)) bool)
(define-map badge-token-id (tuple (user principal) (kind uint)) uint)
(define-map badge-uri uint (string-ascii 256))

(define-map token-kind uint uint)

(define-data-var next-token-id uint u1)
(define-non-fungible-token badge uint)

(define-private (assert-owner)
  (if (is-eq tx-sender CONTRACT_OWNER)
      (ok true)
      (err ERR_NOT_OWNER)
  )
)

(define-read-only (get-current-day)
  (/ stacks-block-height BLOCKS_PER_DAY)
)

(define-read-only (get-streak (user principal))
  (default-to u0 (map-get? streak user))
)

(define-read-only (get-last-claim-day (user principal))
  (default-to u0 (map-get? last-claim-day user))
)

;; Backwards-compatible: "has-badge" means "has the 7-day badge"
(define-read-only (has-badge (user principal))
  (default-to false (map-get? badge-claimed { user: user, kind: BADGE_KIND_7 }))
)

(define-read-only (has-badge-kind (user principal) (kind uint))
  (default-to false (map-get? badge-claimed { user: user, kind: kind }))
)

(define-read-only (get-badge-token-id (user principal) (kind uint))
  (map-get? badge-token-id { user: user, kind: kind })
)

(define-read-only (get-badge-uri (kind uint))
  (map-get? badge-uri kind)
)

(define-read-only (get-badge-kind (token-id uint))
  (map-get? token-kind token-id)
)

(define-public (set-badge-uri (kind uint) (uri (string-ascii 256)))
  (match (assert-owner)
    ok-val (begin
        (map-set badge-uri kind uri)
        (ok true)
      )
    err-code (err err-code)
  )
)

(define-private (mint-badge (user principal) (kind uint))
  (let ((already (default-to false (map-get? badge-claimed { user: user, kind: kind }))))
    (if already
        (err ERR_BADGE_ALREADY_MINTED)
        (let ((token-id (var-get next-token-id)))
          (var-set next-token-id (+ token-id u1))
          (map-set badge-claimed { user: user, kind: kind } true)
          (map-set badge-token-id { user: user, kind: kind } token-id)
          (map-set token-kind token-id kind)
          (match (nft-mint? badge token-id user)
            minted (ok (some token-id))
            err-code (err err-code)
          )
        )
    )
  )
)

(define-private (is-kind-configured (kind uint))
  (is-some (map-get? badge-uri kind))
)

(define-private (maybe-mint (user principal) (new-streak uint) (kind uint))
  ;; Avoid throwing ERR_BADGE_ALREADY_MINTED by checking the claimed map first.
  (let ((already (default-to false (map-get? badge-claimed { user: user, kind: kind }))))
    (if (or already (< new-streak kind) (not (is-kind-configured kind)))
        (ok none)
        (mint-badge user kind)
    )
  )
)

(define-public (mint-badge-kind (kind uint))
  (let (
        (current-streak (default-to u0 (map-get? streak tx-sender)))
       )
    (if (not (is-kind-configured kind))
        (err ERR_BADGE_NOT_CONFIGURED)
        (if (< current-streak kind)
            (err ERR_STREAK_TOO_LOW)
            (match (mint-badge tx-sender kind)
              token-id (ok token-id)
              err-code (err err-code)
            )
        )
    )
  )
)

(define-private (mint-earned-badges (user principal) (new-streak uint))
  ;; Tries all fixed milestones; returns the last minted token-id (if any).
  (match (maybe-mint user new-streak BADGE_KIND_3)
    minted3
    (match (maybe-mint user new-streak BADGE_KIND_7)
      minted7
      (match (maybe-mint user new-streak BADGE_KIND_14)
        minted14
        (match (maybe-mint user new-streak BADGE_KIND_30)
          minted30
          (ok (if (is-some minted30)
                  minted30
                  (if (is-some minted14)
                      minted14
                      (if (is-some minted7)
                          minted7
                          minted3))))
          err30 (err err30))
        err14 (err err14))
      err7 (err err7))
    err3 (err err3))
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
            (let ((mint-result (mint-earned-badges tx-sender new-streak)))
              (match mint-result
                token-id
                (ok {
                  streak: new-streak,
                  day: current-day,
                  badge-minted: (is-some token-id),
                  token-id: token-id
                })
                err-code
                (err err-code)
              )
            )
          )
      )
      (let ((new-streak u1))
        (map-set last-claim-day tx-sender current-day)
        (map-set streak tx-sender new-streak)
        (let ((mint-result (mint-earned-badges tx-sender new-streak)))
          (match mint-result
            token-id
            (ok {
              streak: new-streak,
              day: current-day,
              badge-minted: (is-some token-id),
              token-id: token-id
            })
            err-code
            (err err-code)
          )
        )
      )
    )
  )
)

;; -----------------------
;; SIP-009 Trait Functions
;; -----------------------

(define-read-only (get-last-token-id)
  (let ((next (var-get next-token-id)))
    (if (is-eq next u1)
        (ok u0)
        (ok (- next u1))
    )
  )
)

(define-read-only (get-owner (token-id uint))
  (ok (nft-get-owner? badge token-id))
)

(define-read-only (get-token-uri (token-id uint))
  (match (map-get? token-kind token-id) kind
    (ok (map-get? badge-uri kind))
    (ok none)
  )
)

(define-public (transfer (token-id uint) (sender principal) (recipient principal))
  (if (is-eq tx-sender sender)
      (match (nft-transfer? badge token-id sender recipient)
        transferred (ok true)
        err-code (err err-code)
      )
      (err ERR_NOT_TOKEN_OWNER)
  )
)
