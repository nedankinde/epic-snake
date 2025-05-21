// WebSocket server configuration
export const wsServerUrl = () => {
  // Get port from URL parameters if specified (for testing)
  const urlParams = new URLSearchParams(window.location.search);
  const portParam = urlParams.get('port');
  
  if (portParam && !isNaN(Number(portParam))) {
    // If port is specified in URL, use that
    return `ws://${window.location.hostname}:${portParam}`;
  }
  
  // Default connection URL
  return `ws://${window.location.hostname}:3000`;
};