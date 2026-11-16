import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [admin, styles, browser] = await Promise.all([
  readFile(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/browser.ts', import.meta.url), 'utf8'),
])

assert.match(admin, /useState<'daily' \| 'monthly' \| 'leaders'>\('daily'\)/, 'Thiếu trạng thái phân loại bảng thi đua.')
assert.match(admin, /const \[competitionDate, setCompetitionDate\] = useState\(todayKey\)/, 'Thiếu ngày xem thi đua.')
assert.match(admin, /allocationReportDate\(item\) === competitionDate/, 'Thi đua ngày chưa lọc đúng ngày được chọn.')
assert.match(admin, /receipt\.businessDate === competitionDate/, 'Doanh thu thi đua ngày chưa lọc đúng ngày được chọn.')
assert.match(
  admin,
  /filterCompetitionAttendanceRecords\(records, registrations,[\s\S]{0,180}from: competitionDate,[\s\S]{0,80}to: competitionDate/,
  'Ca có check-in của thi đua ngày chưa lọc đúng ngày được chọn.',
)
assert.doesNotMatch(admin, /TOP 3 NHÂN VIÊN HÔM NAY/, 'Thi đua ngày vẫn là card Top 3 cố định.')
assert.doesNotMatch(admin, /<CompetitionMiniBoard/, 'Thi đua vẫn render bằng card riêng thay vì một bảng phân loại.')
assert.match(admin, /aria-label="Phân loại bảng thi đua"/, 'Thiếu điều khiển phân loại thi đua rõ nghĩa.')
assert.match(admin, /value="daily">Theo ngày</, 'Thiếu phân loại thi đua theo ngày.')
assert.match(admin, /value="monthly">Theo tháng</, 'Thiếu phân loại thi đua theo tháng.')
assert.match(admin, /value="leaders">Ca trưởng theo tháng</, 'Thiếu phân loại thi đua ca trưởng.')
assert.match(admin, /className=\{`competition-classification-table\$\{showReward \? ' with-reward' : ''\}`\}/, 'Thiếu bảng thi đua dùng chung cho các phân loại và biến thể cột thưởng.')
assert.match(admin, /watchVisibleData\(\(\) => refresh\(false\)/, 'Trang quản lý phải dùng bộ đồng bộ theo trạng thái tab/socket.')
assert.match(browser, /window\.addEventListener\('focus', resume\)/, 'Phải làm mới khi quay lại tab.')
assert.match(browser, /document\.addEventListener\('visibilitychange', resume\)/, 'Phải làm mới khi tab hiện lại.')
assert.match(browser, /!connected \|\| Date\.now\(\) - lastStarted >= reconcileMs/, 'Phải có kiểm tra dự phòng khi realtime gián đoạn và đối soát định kỳ.')
assert.match(styles, /\.competition-classification-table/, 'Thiếu CSS bảng phân loại thi đua.')
assert.match(styles, /\.competition-ranking-controls/, 'Thiếu CSS bộ lọc thi đua responsive.')

console.log('MANAGEMENT_DAILY_COMPETITION_REALTIME_OK')
