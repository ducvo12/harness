export default function Header() {
  return (
    <header className={`app-header ${window.granite.platform === 'darwin' ? 'app-header-mac' : ''}`}>
      <div className="app-brand">
        Archon
      </div>
    </header>
  )
}
