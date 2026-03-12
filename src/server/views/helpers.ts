/** Format bytes into human-readable string (e.g. 1.5 TB) */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
}

/** Format a percentage with color class */
export function capacityColor(percent: number): string {
  if (percent >= 90) return 'bg-red-500';
  if (percent >= 80) return 'bg-yellow-500';
  if (percent >= 60) return 'bg-blue-500';
  return 'bg-green-500';
}

/** Format pool health with color */
export function healthColor(health: string): string {
  switch (health) {
    case 'ONLINE': return 'text-green-400';
    case 'DEGRADED': return 'text-yellow-400';
    case 'FAULTED': return 'text-red-400';
    default: return 'text-gray-400';
  }
}

/** Format health dot */
export function healthDot(health: string): string {
  switch (health) {
    case 'ONLINE': return 'bg-green-400';
    case 'DEGRADED': return 'bg-yellow-400';
    case 'FAULTED': return 'bg-red-400';
    default: return 'bg-gray-400';
  }
}

/** Format alert severity badge */
export function severityBadge(severity: string): string {
  switch (severity) {
    case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'warning': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'info': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

/** Format temperature with color */
export function tempColor(celsius: number): string {
  if (celsius >= 60) return 'text-red-400';
  if (celsius >= 50) return 'text-yellow-400';
  return 'text-green-400';
}

/** Format relative time ago */
export function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Format power-on hours to years/days */
export function formatDuration(hours: number): string {
  const days = Math.floor(hours / 24);
  const years = Math.floor(days / 365);
  const remainingDays = days % 365;
  if (years > 0) return `${years}y ${remainingDays}d`;
  return `${days}d ${hours % 24}h`;
}

/** Format ISO date string to readable format */
export function formatDate(isoString: string): string {
  const d = new Date(isoString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${h}:${m}`;
}

/** Truncate string with ellipsis */
export function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len) + '...';
}

/** Count depth of dataset name (slashes) for indentation */
export function indentLevel(datasetName: string): number {
  return (datasetName.match(/\//g) || []).length;
}

/** Escape HTML entities to prevent XSS */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
