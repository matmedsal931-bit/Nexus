// Coloca o ícone e o nome "Nexo" no Nexo.exe (sem precisar do Wine para gerar no Linux)
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit').then(m => m.default || m);
  const exe = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const version = ctx.packager.appInfo.version;
  const data = fs.readFileSync(exe);
  const nt = ResEdit.NtExecutable.from(data, { ignoreCert: true });
  const rs = ResEdit.NtExecutableResource.from(nt);
  // ícone
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(rs.entries);
  const gid = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(rs.entries, gid, lang, ico.icons.map(i => i.data));
  // nome, versão e descrição (o que aparece no Gerenciador de Tarefas)
  const vi = ResEdit.Resource.VersionInfo.fromEntries(rs.entries)[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const [a, b, c] = version.split('.').map(Number);
  vi.setFileVersion(a, b, c, 0, 1033); vi.setProductVersion(a, b, c, 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: 'Nexo', ProductName: 'Nexo', CompanyName: 'Nexo', InternalName: 'Nexo',
    OriginalFilename: 'Nexo.exe', FileVersion: version, ProductVersion: version, LegalCopyright: 'Nexo',
  });
  vi.outputToResourceEntries(rs.entries);
  rs.outputResource(nt);
  fs.writeFileSync(exe, Buffer.from(nt.generate()));
  console.log('  • ícone e nome aplicados em', path.basename(exe));
};
