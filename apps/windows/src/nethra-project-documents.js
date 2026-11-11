'use strict';

/** Compare saved grants with the project catalog using metadata only. */
function projectDocumentStatus(task, latest = []) {
  const byId = new Map(latest.map(document => [document.id, document]));
  return (task.projectDocuments || []).map(grant => {
    const current = byId.get(grant.id);
    return {
      ...grant,
      status: !current || current.revision < grant.revision ||
        (current.revision === grant.revision && current.sha256 !== grant.sha256)
        ? 'UNAVAILABLE' : current.revision > grant.revision ? 'NEWER_AVAILABLE' : 'CURRENT',
      latestRevision: current?.revision ?? null
    };
  });
}

module.exports = {projectDocumentStatus};
