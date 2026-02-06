;; StackUp Streak V2
;;
;; - Daily claim tracking (deterministic day from block height)
;; - Multiple milestone NFT badges
;; - Token URIs via a local SIP-009 trait
;;
;; Notes:
;; - This is a new contract (immutable once deployed). Deploy as `streak-v3-4`.
;; - Set CONTRACT_OWNER to the deploying principal before mainnet deployment.
;;
;; We intentionally do NOT `impl-trait` a separate SIP-009 trait contract here.
;; Some deployment UIs incorrectly flag a `define-trait` that includes a `transfer`
;; signature as a "token transfer outside a function". The contract still exposes
;; the SIP-009-compatible functions (`get-token-uri`, `get-owner`, `transfer`).

;; Owner is captured at deploy time (the contract deployer).
(define-data-var contract-owner principal tx-sender)

(define-constant ERR_ALREADY_CLAIMED u100)
(define-constant ERR_NOT_OWNER u101)
(define-constant ERR_BADGE_ALREADY_MINTED u102)
(define-constant ERR_NOT_TOKEN_OWNER u103)
(define-constant ERR_BADGE_NOT_CONFIGURED u104)
(define-constant ERR_STREAK_TOO_LOW u105)

(define-constant BLOCKS_PER_DAY u144)

;; Fixed milestones (can be expanded in a future version).
(define-constant BADGE_KIND_1 u1)
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

;; Admin-configurable milestone days (kinds) that should be auto-minted by `claim`.
;; Note: list length is capped by the type (20) to keep execution costs bounded.
(define-data-var milestones (list 20 uint) (list BADGE_KIND_1 BADGE_KIND_3 BADGE_KIND_7 BADGE_KIND_14 BADGE_KIND_30))

;; Optional fee (in uSTX) for paid minting (independent of streak).
;; Default is 0 (free).
(define-data-var mint-fee uint u0)
(define-data-var fee-recipient principal tx-sender)

(define-data-var fold-user principal tx-sender)
(define-data-var fold-streak uint u0)

(define-private (assert-owner)
  (if (is-eq tx-sender (var-get contract-owner))
      (ok true)
      (err ERR_NOT_OWNER)
  )
)

(define-public (set-contract-owner (new-owner principal))
  (match (assert-owner)
    ok-val (begin
      (var-set contract-owner new-owner)
      (ok true))
    err-code (err err-code)
  )
)

(define-public (set-milestones (new-milestones (list 20 uint)))
  (match (assert-owner)
    ok-val (begin
      (var-set milestones new-milestones)
      (ok true))
    err-code (err err-code)
  )
)

(define-public (set-mint-fee (new-fee uint))
  (match (assert-owner)
    ok-val (begin
      (var-set mint-fee new-fee)
      (ok true))
    err-code (err err-code)
  )
)

(define-public (set-fee-recipient (recipient principal))
  (match (assert-owner)
    ok-val (begin
      (var-set fee-recipient recipient)
      (ok true))
    err-code (err err-code)
  )
)

(define-read-only (get-current-day)
  (/ stacks-block-height BLOCKS_PER_DAY)
)

(define-read-only (get-milestones)
  (ok (var-get milestones))
)

(define-read-only (get-mint-fee)
  (ok (var-get mint-fee))
)

(define-read-only (get-fee-recipient)
  (ok (var-get fee-recipient))
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

(define-private (mint-step (kind uint) (acc (response (optional uint) uint)))
  ;; `fold` passes (item, accumulator). We store per-call context in data-vars
  ;; because Clarity functions can't close over local `let` bindings.
  (match acc last
    (let ((user (var-get fold-user))
          (new-streak (var-get fold-streak)))
      (match (maybe-mint user new-streak kind)
        minted (ok (if (is-some minted) minted last))
        err-code (err err-code)
      )
    )
    err-code (err err-code)
  )
)

(define-private (mint-earned-badges (user principal) (new-streak uint))
  ;; Tries all configured milestones; returns the last minted token-id (if any).
  (begin
    (var-set fold-user user)
    (var-set fold-streak new-streak)
    (fold mint-step (var-get milestones) (ok none))
  )
)

;; Paid minting (optional). This ignores streak and only requires the badge URI to be configured.
;; Useful for "special" badges you want to sell or give away without changing the streak logic.
(define-public (mint-paid-kind (kind uint))
  (let ((fee (var-get mint-fee)))
    (begin
      (asserts! (is-kind-configured kind) (err ERR_BADGE_NOT_CONFIGURED))
      (if (> fee u0)
          (try! (stx-transfer? fee tx-sender (var-get fee-recipient)))
          true)
      (match (mint-badge tx-sender kind)
        token-id (ok token-id)
        err-code (err err-code)
      )
    )
  )
)

;; Note: paid mints send STX directly to `fee-recipient`, so there is no contract
;; balance to withdraw. If you need contract custody, use `streak-v3-3`.

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
