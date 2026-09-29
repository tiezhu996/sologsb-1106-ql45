<script lang="ts">
  import { onMount } from 'svelte'
  import { repairStore, todayString } from '../../stores/repairStore'
  import { carverStore } from '../../stores/carverStore'
  import type { Block } from '../../types/block'
  import type { ChipRepair, ChipSeverity } from '../../types/repair'

  interface Props {
    block: Block
    readonly?: boolean
  }

  let { block, readonly = false }: Props = $props()

  const severities: ChipSeverity[] = ['轻微', '一般', '严重']

  let blockRepairs = $derived($repairStore.filter((item) => item.blockId === block.id))
  let waitingRepairCount = $derived(blockRepairs.filter((item) => item.status === '待修').length)
  let waitingReviewCount = $derived(blockRepairs.filter((item) => item.status === '待复检').length)
  let releasedCount = $derived(blockRepairs.filter((item) => item.status === '已放行').length)

  // 新崩口登记表单
  let newLocation = $state('')
  let newSeverity = $state<ChipSeverity>('轻微')
  let newFoundAt = $state(todayString())
  let newRepairBy = $state('')
  let newRepairedAt = $state('')
  let newRepairNote = $state('')

  // 每条崩口的修补 / 复检草稿，按 repair.id 存，切换画稿时随组件销毁互不串档
  let submitDrafts = $state<Record<string, { repairBy: string; repairedAt: string; repairNote: string }>>({})
  let reviewDrafts = $state<Record<string, { reviewBy: string; reviewedAt: string; reviewNote: string }>>({})

  let feedback = $state('')

  onMount(() => {
    void carverStore.load()
  })

  $effect(() => {
    for (const repair of blockRepairs) {
      if (repair.status !== '已放行' && !submitDrafts[repair.id]) {
        submitDrafts[repair.id] = { repairBy: repair.repairBy, repairedAt: repair.repairedAt || todayString(), repairNote: repair.repairNote }
      }
      if (!reviewDrafts[repair.id]) {
        reviewDrafts[repair.id] = { reviewBy: '', reviewedAt: todayString(), reviewNote: '' }
      }
    }
  })

  function ensureSubmit(repair: ChipRepair) {
    return (
      submitDrafts[repair.id] ?? { repairBy: repair.repairBy, repairedAt: repair.repairedAt || todayString(), repairNote: repair.repairNote }
    )
  }

  function ensureReview(repair: ChipRepair) {
    return reviewDrafts[repair.id] ?? { reviewBy: '', reviewedAt: todayString(), reviewNote: '' }
  }

  function resetNewForm(): void {
    newLocation = ''
    newSeverity = '轻微'
    newFoundAt = todayString()
    newRepairBy = ''
    newRepairedAt = ''
    newRepairNote = ''
  }

  async function registerChip(directSubmit: boolean): Promise<void> {
    if (!newLocation.trim()) {
      feedback = '请先写清崩口位置。'
      return
    }
    if (!newFoundAt) {
      feedback = '请填写发现日期。'
      return
    }
    if (directSubmit && (!newRepairBy.trim() || !newRepairedAt)) {
      feedback = '直接送检需写清修补人和修补日期。'
      return
    }

    await repairStore.register({
      blockId: block.id,
      draftId: block.draftId,
      location: newLocation,
      severity: newSeverity,
      foundAt: newFoundAt,
      repairBy: newRepairBy,
      repairedAt: newRepairedAt,
      repairNote: newRepairNote,
      directSubmit,
    })
    feedback = directSubmit ? '崩口已修补并送检，等另一名师傅复检。' : '崩口已登记，列入待修。'
    resetNewForm()
  }

  async function sendForReview(repair: ChipRepair): Promise<void> {
    const draft = ensureSubmit(repair)
    const result = await repairStore.submitForReview(repair.id, draft)
    feedback = result.message
  }

  async function reviewChip(repair: ChipRepair, passed: boolean): Promise<void> {
    const draft = ensureReview(repair)
    const result = await repairStore.review(repair.id, { ...draft, passed })
    feedback = result.message
  }

  async function deleteChip(repair: ChipRepair): Promise<void> {
    const result = await repairStore.remove(repair.id)
    feedback = result.message
  }
</script>

<div class="repair-ledger" data-testid={`repair-ledger-${block.id}`}>
  <div class="repair-headline">
    <span>崩口 <strong data-testid={`chip-total-${block.id}`}>{blockRepairs.length}</strong> 处</span>
    <span class="chip-pill waiting">待修 {waitingRepairCount}</span>
    <span class="chip-pill reviewing">待复检 {waitingReviewCount}</span>
    <span class="chip-pill released">已放行 {releasedCount}</span>
  </div>

  {#if block.defectNote}
    <p class="legacy-note">旧备注：{block.defectNote}</p>
  {/if}

  {#each blockRepairs as repair (repair.id)}
    <article class="chip-card status-{repair.status}" data-testid={`chip-row-${repair.id}`}>
      <header class="chip-title">
        <span class="chip-index">第 {repair.seq} 处</span>
        <strong>{repair.location}</strong>
        <span class="chip-pill severity-{severities.indexOf(repair.severity)}">{repair.severity}</span>
        <span class="chip-pill status-pill status-{repair.status}">{repair.status}</span>
      </header>
      <p class="chip-found">发现于 {repair.foundAt}</p>

      {#if repair.status === '待修'}
        {#if submitDrafts[repair.id]}
          {@const draft = submitDrafts[repair.id]}
          <div class="chip-form">
            <label>
              <span>修补人</span>
              <input list={`carvers-${block.id}`} data-testid={`field-repairBy-${repair.id}`} bind:value={draft.repairBy} placeholder="姓名" />
            </label>
            <label>
              <span>修补日期</span>
              <input type="date" data-testid={`field-repairedAt-${repair.id}`} bind:value={draft.repairedAt} />
            </label>
            <label class="chip-wide">
              <span>修补做法</span>
              <textarea rows="2" data-testid={`field-repairNote-${repair.id}`} bind:value={draft.repairNote} placeholder="嵌补、顺线或压平说明"></textarea>
            </label>
            <div class="chip-actions">
              <button class="mini-button strong" type="button" data-testid={`submit-review-${repair.id}`} onclick={() => sendForReview(repair)}>修完送检</button>
              <button class="mini-button" type="button" data-testid={`remove-chip-${repair.id}`} onclick={() => deleteChip(repair)}>删除登记</button>
            </div>
          </div>
        {/if}
      {:else if repair.status === '待复检'}
        <div class="chip-info">
          <p><span>修补</span>{repair.repairBy} · {repair.repairedAt}</p>
          {#if repair.repairNote}<p class="chip-detail">{repair.repairNote}</p>{/if}
        </div>
        {#if reviewDrafts[repair.id]}
          {@const draft = reviewDrafts[repair.id]}
          <div class="chip-form">
            <label>
              <span>复检师傅（须换另一名师傅）</span>
              <input list={`carvers-${block.id}`} data-testid={`field-reviewBy-${repair.id}`} bind:value={draft.reviewBy} placeholder="复检人姓名" />
            </label>
            <label>
              <span>复检日期</span>
              <input type="date" data-testid={`field-reviewedAt-${repair.id}`} bind:value={draft.reviewedAt} />
            </label>
            <label class="chip-wide">
              <span>刀口复检意见</span>
              <textarea rows="2" data-testid={`field-reviewNote-${repair.id}`} bind:value={draft.reviewNote} placeholder="看过刀口是否还崩线"></textarea>
            </label>
            <div class="chip-actions">
              <button class="mini-button strong" type="button" data-testid={`pass-chip-${repair.id}`} onclick={() => reviewChip(repair, true)}>刀口不崩线，放行</button>
              <button class="mini-button" type="button" data-testid={`reject-chip-${repair.id}`} onclick={() => reviewChip(repair, false)}>仍崩线，退回重修</button>
            </div>
          </div>
        {/if}
      {:else}
        <div class="chip-info released-info">
          <p><span>修补</span>{repair.repairBy} · {repair.repairedAt}</p>
          {#if repair.repairNote}<p class="chip-detail">{repair.repairNote}</p>{/if}
          <p class="release-line"><span>放行</span>{repair.reviewBy} · {repair.reviewedAt} 已验刀口不再崩线</p>
          {#if repair.reviewNote}<p class="chip-detail">{repair.reviewNote}</p>{/if}
        </div>
      {/if}

      <details class="chip-events">
        <summary>修补复检流水（{repair.events.length} 条）</summary>
        <ol>
          {#each [...repair.events].sort((a, b) => a.at.localeCompare(b.at)) as event}
            <li>
              <span class="event-type event-{event.type}">{event.type}</span>
              <span class="event-meta">{event.actor} · {event.at.replace('T', ' ')}</span>
              {#if event.note}<p>{event.note}</p>{/if}
            </li>
          {/each}
        </ol>
      </details>
    </article>
  {/each}

  {#if !readonly}
    <article class="chip-card new-chip">
      <header class="chip-title">
        <strong>登记新崩口</strong>
        <span class="chip-pill severity-{severities.indexOf(newSeverity)}">{newSeverity}</span>
      </header>
      <div class="chip-form">
        <label>
          <span>崩口位置</span>
          <input data-testid={`field-chip-location-${block.id}`} bind:value={newLocation} placeholder="如：左袖外缘、桌案转角" />
        </label>
        <label>
          <span>严重程度</span>
          <select bind:value={newSeverity}>
            {#each severities as item}<option value={item}>{item}</option>{/each}
          </select>
        </label>
        <label>
          <span>发现日期</span>
          <input type="date" data-testid={`field-chip-foundAt-${block.id}`} bind:value={newFoundAt} />
        </label>
        <label>
          <span>修补人（已修再填）</span>
          <input list={`carvers-${block.id}`} data-testid={`field-chip-repairBy-${block.id}`} bind:value={newRepairBy} placeholder="未修可留空" />
        </label>
        <label>
          <span>修补日期（已修再填）</span>
          <input type="date" data-testid={`field-chip-repairedAt-${block.id}`} bind:value={newRepairedAt} />
        </label>
        <label class="chip-wide">
          <span>修补做法 / 备注</span>
          <textarea rows="2" data-testid={`field-chip-note-${block.id}`} bind:value={newRepairNote} placeholder="未修可留空，修完后一并补填"></textarea>
        </label>
        <div class="chip-actions">
          <button class="mini-button strong" type="button" data-testid={`register-chip-${block.id}`} onclick={() => registerChip(false)}>登记崩口（待修）</button>
          <button class="mini-button" type="button" data-testid={`register-direct-${block.id}`} onclick={() => registerChip(true)}>修好，直接送检</button>
        </div>
      </div>
    </article>
  {/if}

  <datalist id={`carvers-${block.id}`}>
    {#each $carverStore as carver}
      <option value={carver.name}>{carver.specialty}</option>
    {/each}
  </datalist>

  {#if feedback}<p class="chip-feedback" data-testid={`chip-feedback-${block.id}`}>{feedback}</p>{/if}
</div>

<style>
  .repair-ledger {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    min-width: 0;
    text-align: left;
  }

  .repair-headline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.76rem;
    color: var(--ink-muted);
  }

  .repair-headline strong {
    color: var(--ink);
    font-size: 0.9rem;
  }

  .legacy-note {
    margin: 0;
    padding: 0.35rem 0.55rem;
    border-left: 2px solid var(--line-strong);
    background: color-mix(in srgb, var(--paper) 70%, transparent);
    color: var(--ink-muted);
    font-size: 0.72rem;
    line-height: 1.6;
  }

  .chip-pill {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 0.12rem 0.5rem;
    font-size: 0.68rem;
    font-weight: 800;
    white-space: nowrap;
  }

  .chip-pill.waiting,
  .status-pill.status-待修 {
    color: #8a4b08;
    background: #f5dfb4;
  }

  .chip-pill.reviewing,
  .status-pill.status-待复检 {
    color: #7a3b0d;
    background: #f2c8a3;
  }

  .chip-pill.released,
  .status-pill.status-已放行 {
    color: #1f5c43;
    background: #cde6d8;
  }

  .severity-0 {
    color: #5a6b52;
    background: #e2e9db;
  }

  .severity-1 {
    color: #7a5a17;
    background: #f3e3b3;
  }

  .severity-2 {
    color: #fff;
    background: var(--cinnabar);
  }

  .chip-card {
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    padding: 0.55rem 0.65rem;
    background: color-mix(in srgb, var(--paper) 92%, #fff);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .chip-card.status-待修 {
    border-left: 3px solid #d99a3f;
  }

  .chip-card.status-待复检 {
    border-left: 3px solid #c26a36;
  }

  .chip-card.status-已放行 {
    border-left: 3px solid #3f8a68;
  }

  .new-chip {
    border-style: dashed;
    border-left: 3px dashed var(--line-strong);
  }

  .chip-title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.8rem;
  }

  .chip-index {
    color: var(--ink-muted);
    font-size: 0.7rem;
    font-weight: 700;
  }

  .chip-found {
    margin: 0;
    color: var(--ink-muted);
    font-size: 0.7rem;
  }

  .chip-form {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.4rem 0.6rem;
  }

  .chip-form label {
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
    font-size: 0.68rem;
    color: var(--ink-muted);
    font-weight: 700;
  }

  .chip-form .chip-wide {
    grid-column: 1 / -1;
  }

  .chip-form :global(input),
  .chip-form :global(select),
  .chip-form :global(textarea) {
    padding: 0.3rem 0.42rem;
    font-size: 0.76rem;
  }

  .chip-actions {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .chip-info {
    font-size: 0.74rem;
    color: var(--ink-soft);
  }

  .chip-info p {
    margin: 0;
    line-height: 1.6;
  }

  .chip-info span {
    display: inline-block;
    margin-right: 0.4rem;
    color: var(--ink-muted);
    font-weight: 700;
  }

  .chip-detail {
    color: var(--ink-muted);
  }

  .release-line {
    color: #1f5c43;
    font-weight: 700;
  }

  .chip-events {
    border-top: 1px dashed var(--line);
    padding-top: 0.35rem;
    font-size: 0.7rem;
    color: var(--ink-muted);
  }

  .chip-events summary {
    cursor: pointer;
    font-weight: 700;
  }

  .chip-events ol {
    margin: 0.4rem 0 0;
    padding-left: 0.4rem;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .chip-events li {
    border-left: 2px solid var(--line);
    padding-left: 0.5rem;
  }

  .chip-events p {
    margin: 0.15rem 0 0;
    color: var(--ink-soft);
    line-height: 1.55;
  }

  .event-type {
    display: inline-flex;
    border-radius: 4px;
    padding: 0.05rem 0.35rem;
    margin-right: 0.4rem;
    font-weight: 800;
    background: #ece3d2;
    color: var(--ink-soft);
  }

  .event-复检通过 {
    background: #cde6d8;
    color: #1f5c43;
  }

  .event-退回重修 {
    background: #f3d3c2;
    color: #8a3c14;
  }

  .event-送检 {
    background: #f5e2bf;
    color: #7a5a17;
  }

  .event-meta {
    color: var(--ink-muted);
  }

  .chip-feedback {
    margin: 0;
    padding: 0.35rem 0.55rem;
    border-radius: 4px;
    background: color-mix(in srgb, var(--gold) 22%, var(--paper));
    color: var(--ink);
    font-size: 0.72rem;
  }

  @media (max-width: 760px) {
    .chip-form {
      grid-template-columns: 1fr;
    }
  }
</style>
