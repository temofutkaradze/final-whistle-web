import { prisma } from './lib/db.mjs';
import { runStorageMaintenance, runTemporaryDirectoryMaintenance, measureStorageCapacity } from './lib/storage-maintenance.mjs';

try {
  const scheduled = await runStorageMaintenance({
    prisma,
    mode: 'dry-run',
    includeNewsTemp: true,
    rendererExclusive: false,
  });
  const newsTemp = await runTemporaryDirectoryMaintenance({ name: 'newsTemp', mode: 'dry-run' });
  const rendererTemp = await runTemporaryDirectoryMaintenance({ name: 'rendererTemp', mode: 'dry-run' });
  const capacity = await measureStorageCapacity({ prisma, warn: () => {} });
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), ...scheduled, newsTemp: newsTemp.candidates, rendererTemp: rendererTemp.candidates, capacity }, null, 2));
} finally {
  await prisma.$disconnect();
}
