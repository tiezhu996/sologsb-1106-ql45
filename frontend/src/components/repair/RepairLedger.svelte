<script lang="ts">
  import { onMount } from 'svelte'
  import type { Block } from '../../types/block'
  import type { ChipRepair, InspectionResult, SeverityLevel } from '../../types/repair'
  import { repairStore } from '../../stores/repairStore'
  import { carverStore } from '../../stores/carverStore'

  interface Props {
    block: Block
    readonly?: boolean
  }

  let { block, readonly = false }: Props = $props()

  const severities: SeverityLevel[] = ['轻', '中', '重']

  let chips = $state<ChipRepair[]>([])
  let message = $state('')

  // 登记新崩口
  let showRegister = $state(false)
  let position = $state('')
  let severity = $state<SeverityLevel>('轻')
  let registeredBy = $state('')
  let registeredAt = $state(today())
  let note = $state('')

  // 每处崩口的修补 / 复检表单，按 repairId 隔离，互不串值
  let repairDrafts = $state<Record<string, { repairedBy: string; repairedAt: string; repairMethod: string }>>({})
  let checkDrafts = $state<Record<string, { checkedBy: string; checkedAt: string; result: InspectionResult; checkNote: string }>>({})

  onMount(() => {
    void repairStore.load()
    void carverStore.load()
  })

  $effect(() => {
    chips = $repairStore.filter((item) => item.blockId === block.id)
  })

  $effect(() => {
    if (!registeredBy) registeredBy = block.carvedBy
    for (const chip of chips) {
      if (!repairDrafts[chip.id]) {
        repairDrafts[chip.id] = {
          repairedBy: defaultRepairer(),
          repairedAt: today(),
          repairMethod: '',
        }
      }
      if (!checkDrafts[chip.id]) {
        checkDrafts[chip.id] = {
          checkedBy: defaultInspector(chip),
          checkedAt: today(),
          result: '通过',
          checkNote: '',
        }
      }
    }
  })

  const openCount = $derived(chips.filter((chip) => chip.status !== '已放行').length)
  const repairCount = $derived(chips.filter((chip) => chip.status === '待修').length)
  const checkCount = $derived(chips.filter((chip) => chip.status === '待复检').length)
  const releasedCount = $derived(chips.filter((chip) => chip.status === '已放行').length)

  function today(): string {
    return new Date().toISOString().slice(0, 10)
  }

  function defaultRepairer(): string {
    const repairSpecialist = $carverStore.find((carver) => carver.specialty === '修版')
    return repairSpecialist?.name ?? ''
  }

  // 复检默认带出一名与修补人不同的师傅，方便但不强制。
  function defaultInspector(chip: ChipRepair): string {
    const latest = chip.rounds[chip.rounds.length - 1]
    const candidate = $carverStore.find(
      (carver) => carver.skillLevel === '师傅' && carver.name !== latest?.repairedBy,
    )
    return candidate?.name ?? ''
  }

  async function submitRegister(): Promise<void> {
    if (!position.trim()) {
      message = '请先写明崩口位置。'
      return
    }
    if (!registeredBy.trim()) {
      message = '请填写登记人。'
      return
    }
    await repairStore.registerChip({
      draftId: block.draftId,
      blockId: block.id,
      position: position.trim(),
      severity,
      registeredBy: registeredBy.trim(),
      registeredAt,
      note: note.trim() || undefined,
    })
    position = ''
    severity = '轻'
    note = ''
    registeredAt = today()
    showRegister = false
    message = '崩口已登记，等待修补。'
  }

  async function submitRepair(chip: ChipRepair): Promise<void> {
    const draft = repairDrafts[chip.id]
    if (!draft) return
    if (!draft.repairedBy.trim()) {
      message = `「${chip.position}」请填写修补人。`
      return
    }
    if (!draft.repairedAt) {
      message = `「${chip.position}」请填写修补日期。`
      return
    }
    if (!draft.repairMethod.trim()) {
      message = `「${chip.position}」请写明修法（嵌补、顺线复刀等）。`
      return
    }
    await repairStore.submitRepair(chip.id, {
      repairedBy: draft.repairedBy.trim(),
      repairedAt: draft.repairedAt,
      repairMethod: draft.repairMethod.trim(),
    })
    if (checkDrafts[chip.id]) checkDrafts[chip.id].checkedAt = today()
    message = `「${chip.position}」已修完，进入待复检。`
  }

  async function submitInspection(chip: ChipRepair): Promise<void> {
    const draft = checkDrafts[chip.id]
    if (!draft) return
    if (!draft.checkedBy.trim()) {
      message = `「${chip.position}」请填写复检师傅。`
      return
    }
    if (!draft.checkedAt) {
      message = `「${chip.position}」请填写复检日期。`
      return
    }
    const result = await repairStore.submitInspection(chip.id, {
      checkedBy: draft.checkedBy.trim(),
      checkedAt: draft.checkedAt,
      result: draft.result,
      checkNote: draft.checkNote.trim() || undefined,
    })
    if (!result.ok) {
      message = result.message ?? '复检未登记成功。'
      return
    }
    draft.checkNote = ''
    message =
      draft.result === '通过'
        ? `「${chip.position}」刀口不再崩线，已放行。`
        : `「${chip.position}」复检未过，已退回继续修。`
  }

  async function removeChip(chip: ChipRepair): Promise<void> {
    await repairStore.removeChip(chip.id)
    message = `已删除误登记的「${chip.position}」。`
  }
</script>

<div class="repair-ledger" data-testid={`repair-ledger-${block.id}`}>
  <div class="ledger-head">
    <span class="chip-count">崩口 {chips.length} 处</span>
    {#if repairCount > 0}<span class="chip-badge wait-repair">待修 {repairCount}</span>{/if}
    {#if checkCount > 0}<span class="chip-badge wait-check">待复检 {checkCount}</span>{/if}
    {#if releasedCount > 0}<span class="chip-badge released">已放行 {releasedCount}</span>{/if}
    {#if !readonly && !showRegister}
      <button class="mini-button" type="button" data-testid={`show-register-${block.id}`} onclick={() => (showRegister = true)}>
        登记崩口
      </button>
    {/if}
  </div>

  {#if !readonly && showRegister}
    <div class="chip-form register-form">
      <h4>登记新崩口</h4>
      <div class="chip-fields">
        <label>
          <span>位置</span>
          <input data-testid={`field-position-${block.id}`} bind:value={position} placeholder="如：右下荷叶卷边" />
        </label>
        <label class="severity-field">
          <span>严重程度</span>
          <select bind:value={severity}>
            {#each severities as item}<option value={item}>{item}</option>{/each}
          </select>
        </label>
        <label>
          <span>登记人</span>
          <input bind:value={registeredBy} placeholder="发现崩口的师傅" list={`carver-names-${block.id}`} />
        </label>
        <label>
          <span>登记日期</span>
          <input type="date" bind:value={registeredAt} />
        </label>
        <label class="full-line">
          <span>崩口说明</span>
          <textarea rows="2" bind:value={note} placeholder="刀口崩线长度、试印表现等"></textarea>
        </label>
      </div>
      <div class="chip-actions">
        <button class="mini-button strong" type="button" data-testid={`submit-register-${block.id}`} onclick={submitRegister}>存崩口</button>
        <button class="mini-button" type="button" onclick={() => (showRegister = false)}>收起</button>
      </div>
    </div>
  {/if}

  {#if chips.length === 0}
    <p class="ledger-empty">暂无崩口记录，刻成验线时发现问题可逐处登记。</p>
  {:else}
    <ol class="chip-list">
      {#each chips as chip (chip.id)}
        <li class="chip-card" data-status={chip.status}>
          <div class="chip-title">
            <strong>{chip.position}</strong>
            <span class="chip-badge severity" data-severity={chip.severity}>{chip.severity}</span>
            <span class="chip-badge chip-status-{chip.status}">{chip.status}</span>
          </div>
          <p class="chip-meta">登记 {chip.registeredAt} · {chip.registeredBy}</p>
          {#if chip.note}<p class="chip-note">{chip.note}</p>{/if}

          {#if chip.rounds.length > 0}
            <ol class="round-list">
              {#each chip.rounds as round, roundIndex (round.seq)}
                <li>
                  <div class="round-head">
                    <strong>第 {round.seq} 轮修补</strong>
                    {#if round.result}
                      <span class="chip-badge result-{round.result}">复检{round.result}</span>
                    {:else}
                      <span class="chip-badge wait-check">等复检</span>
                    {/if}
                  </div>
                  <p class="round-line">{round.repairMethod}</p>
                  <small>修：{round.repairedBy} · {round.repairedAt}</small>
                  {#if round.checkedBy}
                    <p class="round-line">
                      验：{round.checkedBy} · {round.checkedAt ?? '日期未填'}
                      {#if round.checkNote} — {round.checkNote}{/if}
                    </p>
                  {:else if !readonly}
                    <small class="await-check">修补已交活，等另一名师傅看刀口。</small>
                  {/if}
                </li>
              {/each}
            </ol>
          {/if}

          {#if !readonly}
            {#if chip.status === '待修'}
              {@const draft = repairDrafts[chip.id]}
              {#if draft}
                <div class="chip-form">
                  <h4>修补登记（第 {chip.rounds.length + 1} 轮）</h4>
                  <div class="chip-fields">
                    <label>
                      <span>修补人</span>
                      <input data-testid={`field-repairer-${chip.id}`} bind:value={draft.repairedBy} list={`carver-names-${block.id}`} placeholder="修补师傅姓名" />
                    </label>
                    <label>
                      <span>修补日期</span>
                      <input type="date" bind:value={draft.repairedAt} />
                    </label>
                    <label class="full-line">
                      <span>修法说明</span>
                      <textarea rows="2" data-testid={`field-repairMethod-${chip.id}`} bind:value={draft.repairMethod} placeholder="嵌木、补线、顺线复刀等做法"></textarea>
                    </label>
                  </div>
                  <div class="chip-actions">
                    <button class="mini-button strong" type="button" data-testid={`submit-repair-${chip.id}`} onclick={() => submitRepair(chip)}>修完，送复检</button>
                    {#if chip.rounds.length === 0}
                      <button class="mini-button danger-link" type="button" onclick={() => removeChip(chip)}>误登记，删除</button>
                    {/if}
                  </div>
                </div>
              {/if}
            {:else if chip.status === '待复检'}
              {@const draft = checkDrafts[chip.id]}
              {#if draft}
                <div class="chip-form">
                  <h4>复检放行</h4>
                  <div class="chip-fields">
                    <label>
                      <span>复检师傅</span>
                      <input data-testid={`field-checker-${chip.id}`} bind:value={draft.checkedBy} list={`carver-names-${block.id}`} placeholder="须非本轮修补人" />
                    </label>
                    <label>
                      <span>复检日期</span>
                      <input type="date" bind:value={draft.checkedAt} />
                    </label>
                    <label class="severity-field">
                      <span>刀口结论</span>
                      <select data-testid={`field-result-${chip.id}`} bind:value={draft.result}>
                        <option value="通过">刀口不再崩线，放行</option>
                        <option value="未过">仍崩线，退回再修</option>
                      </select>
                    </label>
                    <label class="full-line">
                      <span>复检备注</span>
                      <textarea rows="2" data-testid={`field-checkNote-${chip.id}`} bind:value={draft.checkNote} placeholder="看过刀口、试印后的结论"></textarea>
                    </label>
                  </div>
                  <div class="chip-actions">
                    <button class="mini-button strong" type="button" data-testid={`submit-inspection-${chip.id}`} onclick={() => submitInspection(chip)}>提交复检</button>
                  </div>
                </div>
              {/if}
            {/if}
          {/if}
        </li>
      {/each}
    </ol>
  {/if}

  <datalist id={`carver-names-${block.id}`}>
    {#each $carverStore as carver}
      <option value={carver.name}>{carver.specialty}</option>
    {/each}
  </datalist>

  {#if message}<p class="ledger-message" data-testid={`repair-message-${block.id}`}>{message}</p>{/if}
</div>

<style>
  .repair-ledger {
    display: grid;
    gap: 0.6rem;
    min-width: 19rem;
  }

  .ledger-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .chip-count {
    font-weight: 800;
    font-size: 0.78rem;
    color: var(--ink-soft);
  }

  .chip-badge {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 0.14rem 0.5rem;
    font-size: 0.68rem;
    font-weight: 800;
    white-space: nowrap;
    background: #ece2d0;
    color: var(--ink-soft);
  }

  .chip-badge.wait-repair {
    background: #f6e0d4;
    color: var(--cinnabar-dark);
  }

  .chip-badge.wait-check {
    background: #f3e6c4;
    color: #8a5f14;
  }

  .chip-badge.released,
  .chip-badge.result-通过 {
    background: #d8ebe1;
    color: var(--jade);
  }

  .chip-badge.result-未过 {
    background: #f6e0d4;
    color: var(--cinnabar-dark);
  }

  .chip-badge.severity[data-severity='轻'] {
    background: #e4eadf;
    color: #4c6b39;
  }

  .chip-badge.severity[data-severity='中'] {
    background: #f3e6c4;
    color: #8a5f14;
  }

  .chip-badge.severity[data-severity='重'] {
    background: var(--cinnabar);
    color: #fff;
  }

  .chip-status-待修 {
    background: #f6e0d4;
    color: var(--cinnabar-dark);
  }

  .chip-status-待复检 {
    background: #f3e6c4;
    color: #8a5f14;
  }

  .chip-status-已放行 {
    background: #d8ebe1;
    color: var(--jade);
  }

  .ledger-empty {
    margin: 0;
    color: var(--ink-muted);
    font-size: 0.76rem;
    line-height: 1.55;
  }

  .chip-list {
    list-style: none;
    display: grid;
    gap: 0.55rem;
    margin: 0;
    padding: 0;
  }

  .chip-card {
    border: 1px solid var(--line);
    border-left: 3px solid var(--line-strong);
    border-radius: var(--radius-sm);
    padding: 0.6rem 0.65rem;
    background: #fffdf8;
  }

  .chip-card[data-status='待修'] {
    border-left-color: var(--cinnabar);
  }

  .chip-card[data-status='待复检'] {
    border-left-color: var(--gold);
  }

  .chip-card[data-status='已放行'] {
    border-left-color: var(--jade);
  }

  .chip-title {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .chip-title strong {
    font-size: 0.8rem;
  }

  .chip-meta {
    margin: 0.25rem 0 0;
    color: var(--ink-muted);
    font-size: 0.7rem;
  }

  .chip-note {
    margin: 0.35rem 0 0;
    color: var(--ink-soft);
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .round-list {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0.45rem 0 0;
    border-top: 1px dashed var(--line);
    display: grid;
    gap: 0.5rem;
  }

  .round-list li {
    display: grid;
    gap: 0.18rem;
  }

  .round-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .round-head strong {
    font-size: 0.74rem;
    color: var(--ink-soft);
  }

  .round-line {
    margin: 0;
    font-size: 0.74rem;
    line-height: 1.5;
    color: var(--ink-soft);
  }

  .round-list small {
    color: var(--ink-muted);
    font-size: 0.7rem;
  }

  .await-check {
    color: var(--gold) !important;
    font-weight: 700;
  }

  .chip-form {
    margin-top: 0.55rem;
    padding: 0.6rem;
    border: 1px solid rgba(169, 52, 39, 0.22);
    border-radius: var(--radius-sm);
    background: #fff9f1;
  }

  .register-form {
    background: #fbf3e6;
  }

  .chip-form h4 {
    margin: 0 0 0.5rem;
    font-size: 0.76rem;
    color: var(--cinnabar-dark);
  }

  .chip-fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .chip-fields label {
    display: grid;
    gap: 0.25rem;
  }

  .chip-fields label > span {
    font-size: 0.68rem;
    font-weight: 800;
    color: var(--ink-soft);
  }

  .chip-fields input,
  .chip-fields select,
  .chip-fields textarea {
    min-height: 2.1rem;
    padding: 0.35rem 0.5rem;
    font-size: 0.76rem;
  }

  .chip-fields .severity-field {
    min-width: 0;
  }

  .full-line {
    grid-column: 1 / -1;
  }

  .chip-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.55rem;
  }

  .danger-link {
    color: var(--cinnabar) !important;
    background: transparent !important;
  }

  .ledger-message {
    margin: 0;
    border-left: 3px solid var(--cinnabar);
    padding: 0.4rem 0.55rem;
    background: rgba(169, 52, 39, 0.065);
    color: var(--cinnabar-dark);
    font-size: 0.72rem;
    line-height: 1.5;
  }
</style>
