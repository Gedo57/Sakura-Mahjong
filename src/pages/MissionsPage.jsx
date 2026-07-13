import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../router/routes.js';
import { claimMission, getMissions } from '../services/missionsService.js';

const missionIcon = '/assets/missions/icon-missions.png';

function formatNumber(value, fallback = '0') {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : fallback;
}

function pickMissionReward(mission = {}) {
  const explicitReward = mission.reward
    || mission.rewards
    || mission.rewardData
    || mission.rewardInfo
    || mission.prize
    || mission.payout;

  if (explicitReward) {
    return explicitReward;
  }

  const amount = mission.rewardAmount
    ?? mission.rewardValue
    ?? mission.xpReward
    ?? mission.seasonXpReward
    ?? mission.seasonXPReward
    ?? mission.xp
    ?? mission.seasonXp
    ?? mission.seasonXP;

  if (amount !== undefined && amount !== null && amount !== '') {
    return {
      amount,
      type: mission.rewardType || mission.rewardCurrency || mission.currency || 'season_xp',
    };
  }

  return null;
}

function normalizeRewardEntries(reward) {
  if (!reward) return [];

  if (Array.isArray(reward)) {
    return reward.flatMap(normalizeRewardEntries);
  }

  if (typeof reward === 'number' || (typeof reward === 'string' && reward.trim())) {
    return [{ amount: reward, type: 'Season XP' }];
  }

  if (typeof reward !== 'object') return [];

  const entries = [];
  const directAmount = reward.amount ?? reward.value ?? reward.quantity ?? reward.qty;
  const directType = reward.type || reward.currency || reward.itemName || reward.name || reward.label;

  if (directAmount !== undefined || directType) {
    entries.push({ amount: directAmount, type: directType || 'Reward' });
  }

  const keyedRewards = [
    ['coins', 'Coins'],
    ['coin', 'Coins'],
    ['coinsAdded', 'Coins'],
    ['diamonds', 'Gems'],
    ['gems', 'Gems'],
    ['diamondsAdded', 'Gems'],
    ['xp', 'XP'],
    ['seasonXp', 'Season XP'],
    ['seasonXP', 'Season XP'],
    ['passXp', 'Season XP'],
    ['passXP', 'Season XP'],
    ['trophies', 'Trophies'],
  ];

  keyedRewards.forEach(([key, label]) => {
    const value = reward[key];
    if (value !== undefined && value !== null && value !== '' && Number(value) !== 0) {
      entries.push({ amount: value, type: label });
    }
  });

  const chest = reward.chest || reward.chestGiven || reward.box || reward.item;
  if (chest) {
    entries.push({ amount: '', type: typeof chest === 'string' ? chest : chest.name || chest.itemName || 'Chest' });
  }

  return entries;
}

function getMissionType(mission = {}) {
  const rawType = String(mission.type || mission.period || mission.frequency || mission.resetType || mission.category || '').toLowerCase();

  if (rawType.includes('week')) {
    return 'weekly';
  }

  if (rawType.includes('day') || rawType.includes('daily')) {
    return 'daily';
  }

  const title = String(mission.title || mission.name || '').toLowerCase();
  if (title.includes('weekly') || title.includes('week')) {
    return 'weekly';
  }

  return 'daily';
}

function normalizeMission(mission, index, fallbackType = 'daily') {
  const type = getMissionType(mission) || fallbackType;
  const progress = Number(mission.progress ?? mission.currentProgress ?? mission.current ?? 0);
  const target = Number(mission.target ?? mission.goal ?? mission.required ?? 1);
  const safeTarget = Number.isFinite(target) && target > 0 ? target : 1;
  const safeProgress = Number.isFinite(progress) ? Math.max(0, progress) : 0;

  return {
    id: mission.id || mission.missionId || mission._id || mission.key || `${type}_mission_${index}`,
    title: mission.title || mission.name || 'Mission',
    progress: Math.min(safeProgress, safeTarget),
    target: safeTarget,
    type,
    claimed: Boolean(mission.claimed || mission.isClaimed || mission.rewardClaimed),
    reward: pickMissionReward(mission),
  };
}

function formatReward(reward) {
  const entries = normalizeRewardEntries(reward);

  if (!entries.length) {
    return 'Reward';
  }

  return entries.map((entry) => {
    const type = String(entry.type || 'Reward')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
    const amount = entry.amount;

    if (amount === undefined || amount === null || amount === '') {
      return type;
    }

    return `${formatNumber(amount)} ${type}`;
  }).join(' + ');
}


function getNextDailyResetText() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const totalSeconds = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function getNextWeeklyResetText() {
  const now = new Date();
  const next = new Date(now);
  const day = next.getDay();
  const daysUntilMonday = (8 - day) % 7 || 7;
  next.setDate(next.getDate() + daysUntilMonday);
  next.setHours(0, 0, 0, 0);
  const totalSeconds = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  return `${days}d ${hours}h`;
}

function MissionCard({ mission, onClaim, isClaiming }) {
  const percentage = Math.max(0, Math.min(100, Math.round((mission.progress / mission.target) * 100)));
  const isComplete = mission.progress >= mission.target;

  return (
    <article className={`mission-card mission-card-${mission.type}${isComplete ? ' is-complete' : ''}${mission.claimed ? ' is-claimed' : ''}`}>
      <div className="mission-card-main">
        <img className="mission-card-icon" src={missionIcon} alt="" />
        <div className="mission-card-copy">
          <strong>{mission.title}</strong>
          <span>{formatReward(mission.reward)}</span>
        </div>
        <div className="mission-progress-values">
          <b>{formatNumber(mission.progress)}</b>
          <span>/ {formatNumber(mission.target)}</span>
        </div>
      </div>

      <div className="mission-progress-track" aria-hidden="true">
        <span style={{ width: `${percentage}%` }} />
        <small className="mission-progress-label">{percentage}% complete</small>
      </div>

      <div className="mission-card-footer">
        {mission.claimed ? (
          <span className="mission-claimed-label">Claimed</span>
        ) : (
          <button type="button" onClick={() => onClaim(mission.id)} disabled={!isComplete || isClaiming}>
            {isClaiming ? 'Claiming...' : 'Claim'}
          </button>
        )}
      </div>
    </article>
  );
}

function MissionSection({ title, subtitle, resetText, missions, onClaim, claimingMissionId }) {
  return (
    <section className="mission-section">
      <header className="mission-section-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <span>{resetText}</span>
      </header>

      <div className="mission-grid">
        {missions.length ? missions.map((mission) => (
          <MissionCard
            key={mission.id}
            mission={mission}
            onClaim={onClaim}
            isClaiming={claimingMissionId === mission.id}
          />
        )) : (
          <div className="missions-empty-state">No missions available.</div>
        )}
      </div>
    </section>
  );
}

export default function MissionsPage() {
  const navigate = useNavigate();
  const [missions, setMissions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [claimingMissionId, setClaimingMissionId] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [resetTick, setResetTick] = useState(0);

  const loadMissions = useCallback(async ({ keepStatusMessage = false } = {}) => {
    setIsLoading(true);
    if (!keepStatusMessage) {
      setStatusMessage('');
    }

    try {
      const backendMissions = await getMissions();
      setMissions(backendMissions.map(normalizeMission));
    } catch (error) {
      console.error('Failed to load missions:', error);
      setMissions([]);
      setStatusMessage(error?.message || 'Failed to load missions');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMissions();
  }, [loadMissions]);

  useEffect(() => {
    const timer = window.setInterval(() => setResetTick((value) => value + 1), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const groupedMissions = useMemo(() => {
    const normalized = missions.map(normalizeMission);

    return {
      daily: normalized.filter((mission) => mission.type === 'daily'),
      weekly: normalized.filter((mission) => mission.type === 'weekly'),
    };
  }, [missions]);

  const handleClaim = async (missionId) => {
    if (!missionId) return;

    setClaimingMissionId(missionId);
    setStatusMessage('');

    try {
      const response = await claimMission(missionId);
      const reward = response?.reward || response?.rewards || response?.data?.reward || response?.data?.rewards;
      setStatusMessage(`Reward claimed: ${formatReward(reward)}`);
      await loadMissions({ keepStatusMessage: true });
    } catch (error) {
      console.error('Failed to claim mission:', error);
      setStatusMessage(error?.message || 'Failed to claim mission reward');
    } finally {
      setClaimingMissionId('');
    }
  };

  return (
    <section className="missions-page-ui">
      <header className="missions-header">
        <button className="missions-back-button" type="button" onClick={() => navigate(ROUTES.mainMenu)}>
          ‹ Back
        </button>

        <div className="missions-title-wrap">
          <img src={missionIcon} alt="" />
          <div>
            <h1>Missions</h1>
            <p>Daily and weekly tasks</p>
          </div>
        </div>
      </header>

      {isLoading && <div className="missions-status-message">Loading missions...</div>}
      {statusMessage && <div className="missions-status-message">{statusMessage}</div>}

      <main className="missions-content">
        <MissionSection
          title="Daily Missions"
          subtitle="Resets every day"
          resetText={`Reset in ${getNextDailyResetText(resetTick)}`}
          missions={groupedMissions.daily}
          onClaim={handleClaim}
          claimingMissionId={claimingMissionId}
        />

        <MissionSection
          title="Weekly Missions"
          subtitle="Bigger targets and bigger season XP"
          resetText={`Reset in ${getNextWeeklyResetText(resetTick)}`}
          missions={groupedMissions.weekly}
          onClaim={handleClaim}
          claimingMissionId={claimingMissionId}
        />
      </main>
    </section>
  );
}
