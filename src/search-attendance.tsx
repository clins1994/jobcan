import { Action, ActionPanel, Color, Grid, Icon, List, showToast, Toast, getPreferenceValues } from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { getAttendance } from "./lib/api";
import { ensureValidSession } from "./lib/auth";
import { CACHE_KEYS, getCached, setCached, removeCached } from "./lib/cache";
import { AttendanceEntry, AttendanceResponse, AttendanceStatus } from "./lib/types";

function getCurrentAndPreviousMonth(): {
  current: { year: number; month: number };
  previous: { year: number; month: number };
} {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  let previousYear = currentYear;
  let previousMonth = currentMonth - 1;

  if (previousMonth < 1) {
    previousMonth = 12;
    previousYear = currentYear - 1;
  }

  return {
    current: { year: currentYear, month: currentMonth },
    previous: { year: previousYear, month: previousMonth },
  };
}

function getStatusIcon(entry: AttendanceEntry, isGrid = false): Icon | string | { source: string; tintColor?: Color } {
  switch (entry.status) {
    case AttendanceStatus.HolidayWork:
    case AttendanceStatus.Logged:
      return Icon.Check;
    case AttendanceStatus.Absence:
    case AttendanceStatus.Late:
      return Icon.ExclamationMark;
    case AttendanceStatus.PaidVacation:
    case AttendanceStatus.SubstitutionHoliday:
      return Icon.Check;
    case AttendanceStatus.Holiday:
    case AttendanceStatus.Unlogged:
    default:
      return { source: `nothing-to-do-here${isGrid ? "-padded" : ""}.png` };
  }
}

function getStatusColor(entry: AttendanceEntry): Color {
  switch (entry.status) {
    case AttendanceStatus.HolidayWork:
    case AttendanceStatus.Logged:
      return Color.Green;
    case AttendanceStatus.Absence:
    case AttendanceStatus.Late:
      return Color.Yellow;
    case AttendanceStatus.PaidVacation:
    case AttendanceStatus.SubstitutionHoliday:
      return Color.Blue;
    case AttendanceStatus.Holiday:
    case AttendanceStatus.Unlogged:
    default:
      return Color.PrimaryText;
  }
}

function formatStatus(entry: AttendanceEntry): string {
  if (entry.rawStatus.length === 0) {
    return entry.status;
  }
  return entry.rawStatus.join(", ");
}

function formatDate(date: string, dayOfWeek: string): string {
  const dateObj = new Date(date);
  const month = dateObj.toLocaleString("en-US", { month: "short" });
  const day = dateObj.getDate();
  return `${month} ${day} (${dayOfWeek})`;
}

function formatAttendanceEntry(entry: AttendanceEntry): string {
  const date = formatDate(entry.date, entry.dayOfWeek);
  const timeRange = entry.clockIn && entry.clockOut ? `${entry.clockIn} - ${entry.clockOut}` : entry.shiftTime || "";
  const hours = entry.workingHours ? `Hours: ${entry.workingHours}` : "";
  const status = formatStatus(entry);
  return `${date}${timeRange ? ` - ${timeRange}` : ""}${hours ? ` - ${hours}` : ""}${status ? ` - ${status}` : ""}`;
}

export default function Command() {
  const { current, previous } = getCurrentAndPreviousMonth();
  const preferences = getPreferenceValues<{ 
    hideHolidays: boolean; 
    useGridsOverLists: boolean; 
    gridColumns: string;
    attendancePeriodFilter: string;
  }>();
  const [attendance, setAttendance] = useState<AttendanceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<"current" | "previous" | "last30days" | "all">(
    (preferences.attendancePeriodFilter as "current" | "previous" | "last30days" | "all") || "all"
  );
  const [hideHolidays, setHideHolidays] = useState<boolean>(preferences.hideHolidays);
  const [useGrid, setUseGrid] = useState<boolean>(preferences.useGridsOverLists);
  const [gridColumns, setGridColumns] = useState<number>(parseInt(preferences.gridColumns, 10) || 4);
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    // Prevent duplicate requests in React StrictMode
    if (hasFetchedRef.current) {
      return;
    }
    hasFetchedRef.current = true;

    async function fetchAttendance() {
      try {
        setIsLoading(true);
        setError(null);

        if (selectedPeriod === "current") {
          // Fetch only current month
          const cacheKey = CACHE_KEYS.attendance(current.year, current.month);
          const cached = await getCached<AttendanceResponse>(cacheKey);

          if (cached && cached.entries.length > 0) {
            setAttendance(cached);
            setIsLoading(false);

            // Fetch fresh data in background
            try {
              await ensureValidSession();
              const data = await getAttendance(current.year, current.month);
              setAttendance(data);
              await setCached(cacheKey, data);
            } catch (error) {
              console.debug(`[Search Attendance] Background refresh failed: ${error}`);
            }
            return;
          }

          await ensureValidSession();
          const data = await getAttendance(current.year, current.month);
          setAttendance(data);
          await setCached(cacheKey, data);
        } else if (selectedPeriod === "previous") {
          // Fetch only previous month
          const cacheKey = CACHE_KEYS.attendance(previous.year, previous.month);
          const cached = await getCached<AttendanceResponse>(cacheKey);

          if (cached && cached.entries.length > 0) {
            setAttendance(cached);
            setIsLoading(false);

            // Fetch fresh data in background
            try {
              await ensureValidSession();
              const data = await getAttendance(previous.year, previous.month);
              setAttendance(data);
              await setCached(cacheKey, data);
            } catch (error) {
              console.debug(`[Search Attendance] Background refresh failed: ${error}`);
            }
            return;
          }

          await ensureValidSession();
          const data = await getAttendance(previous.year, previous.month);
          setAttendance(data);
          await setCached(cacheKey, data);
        } else {
          // Fetch both current and previous months for "all" and "last30days"
          const currentCacheKey = CACHE_KEYS.attendance(current.year, current.month);
          const previousCacheKey = CACHE_KEYS.attendance(previous.year, previous.month);

          const cachedCurrent = await getCached<AttendanceResponse>(currentCacheKey);
          const cachedPrevious = await getCached<AttendanceResponse>(previousCacheKey);

          // If both are cached, use them and fetch in background
          if (cachedCurrent && cachedPrevious) {
            setAttendance({
              entries: [...cachedPrevious.entries, ...cachedCurrent.entries],
              year: current.year,
              month: current.month,
            });
            setIsLoading(false);

            // Fetch fresh data in background
            try {
              await ensureValidSession();
              const [currentData, previousData] = await Promise.all([
                getAttendance(current.year, current.month),
                getAttendance(previous.year, previous.month),
              ]);
              setAttendance({
                entries: [...previousData.entries, ...currentData.entries],
                year: current.year,
                month: current.month,
              });
              await setCached(currentCacheKey, currentData);
              await setCached(previousCacheKey, previousData);
            } catch (error) {
              console.debug(`[Search Attendance] Background refresh failed: ${error}`);
              if (
                error instanceof Error &&
                (error.message.includes("authentication") || error.message.includes("preferences"))
              ) {
                await removeCached(currentCacheKey);
                await removeCached(previousCacheKey);
                setAttendance(null);
                setError(error.message);
                await showToast({
                  style: Toast.Style.Failure,
                  title: "Authentication required",
                  message: "Please check your credentials in extension preferences",
                });
                return;
              }
            }
            return;
          }

          // No cache, fetch fresh data
          await ensureValidSession();
          const [currentData, previousData] = await Promise.all([
            getAttendance(current.year, current.month),
            getAttendance(previous.year, previous.month),
          ]);
          setAttendance({
            entries: [...previousData.entries, ...currentData.entries],
            year: current.year,
            month: current.month,
          });
          await setCached(currentCacheKey, currentData);
          await setCached(previousCacheKey, previousData);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Failed to fetch attendance";
        setError(errorMessage);
        await showToast({
          style: Toast.Style.Failure,
          title: "Error",
          message: errorMessage,
        });
      } finally {
        setIsLoading(false);
      }
    }

    fetchAttendance();
  }, [selectedPeriod, current.year, current.month, previous.year, previous.month, preferences.hideHolidays, preferences.useGridsOverLists, preferences.gridColumns, preferences.attendancePeriodFilter]);

  const handlePeriodChange = (period: string) => {
    setSelectedPeriod(period as "current" | "previous" | "last30days" | "all");
    hasFetchedRef.current = false;
  };

  // Filter entries: exclude future dates, today, and holidays (if hideHolidays is true)
  // But always show holidays that have work data (clockIn, clockOut, workingHours)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const filteredEntries = (attendance?.entries.filter((entry) => {
    const entryDate = new Date(entry.date);
    entryDate.setHours(0, 0, 0, 0);

    // Exclude future dates and today
    if (entryDate >= today) {
      return false;
    }

    // Check if entry has work data (clockIn, clockOut, and workingHours)
    const hasWorkData = entry.clockIn && entry.clockOut && entry.workingHours;

    // Exclude holidays if hideHolidays is true, but always show holidays with work data
    if (hideHolidays && entry.holidayType && !hasWorkData) {
      return false;
    }

    return true;
  }) || []).sort((a, b) => {
    // Sort by date in descending order (latest first)
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    return dateB - dateA;
  });

  const rotateGridColumns = () => {
    const columns = [5, 6, 7, 8];
    const currentIndex = columns.indexOf(gridColumns);
    const nextIndex = (currentIndex + 1) % columns.length;
    setGridColumns(columns[nextIndex]);
  };

  const commonActions = (entry: AttendanceEntry) => (
    <ActionPanel>
      <Action
        title={useGrid ? "Switch to List View" : "Switch to Grid View"}
        icon={useGrid ? Icon.List : Icon.AppWindowGrid3x3}
        onAction={() => setUseGrid(!useGrid)}
        shortcut={{ modifiers: [], key: "enter" }}
      />
      <Action
        title={hideHolidays ? "Show Holidays" : "Hide Holidays"}
        icon={Icon.Eye}
        onAction={() => setHideHolidays(!hideHolidays)}
      />
      {useGrid && (
        <Action
          title={`Grid Columns: ${gridColumns} (Rotate)`}
          icon={Icon.AppWindowGrid3x3}
          onAction={rotateGridColumns}
          shortcut={{ modifiers: ["cmd"], key: "g" }}
        />
      )}
      {entry.clockIn && entry.clockOut && (
        <Action.CopyToClipboard
          title="Copy Time Range"
          icon={Icon.Clipboard}
          content={`${entry.clockIn} - ${entry.clockOut}`}
        />
      )}
      <Action.CopyToClipboard
        title="Copy Entry Details"
        icon={Icon.Clipboard}
        content={formatAttendanceEntry(entry)}
      />
    </ActionPanel>
  );

  if (error && !attendance) {
    return (
      <List>
        <List.EmptyView icon={Icon.ExclamationMark} title="Error Loading Attendance" description={error} />
      </List>
    );
  }

  if (useGrid) {
    return (
      <Grid
        isLoading={isLoading}
        columns={gridColumns}
        searchBarPlaceholder="Search attendance..."
        searchBarAccessory={
          <Grid.Dropdown
            tooltip="Select Period"
            value={selectedPeriod}
            onChange={handlePeriodChange}
          >
            <Grid.Dropdown.Item key="all" title="All" value="all" />
            <Grid.Dropdown.Item key="last30days" title="Last 30 Days" value="last30days" />
            <Grid.Dropdown.Item key="current" title="Current Month" value="current" />
            <Grid.Dropdown.Item key="previous" title="Previous Month" value="previous" />
          </Grid.Dropdown>
        }
      >
        {filteredEntries.length === 0 && !isLoading ? (
          <Grid.EmptyView
            icon={Icon.Calendar}
            title="No Attendance Data"
            description="No attendance records found for the selected period"
          />
        ) : (
          filteredEntries.map((entry: AttendanceEntry) => {
            const icon = getStatusIcon(entry, true);
            const isCustomImage = typeof icon === "object";
            return (
              <Grid.Item
                key={entry.date}
                content={
                  isCustomImage
                    ? { 
                        value: icon,
                        tooltip: formatDate(entry.date, entry.dayOfWeek)
                      }
                    : {
                        source: icon,
                        tintColor: getStatusColor(entry),
                      }
                }
                title={formatDate(entry.date, entry.dayOfWeek)}
                actions={commonActions(entry)}
              />
            );
          })
        )}
      </Grid>
    );
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search attendance..."
      searchBarAccessory={
      <List.Dropdown
        tooltip="Select Period"
        value={selectedPeriod}
        onChange={handlePeriodChange}
      >
        <List.Dropdown.Item key="all" title="All" value="all" />
        <List.Dropdown.Item key="last30days" title="Last 30 Days" value="last30days" />
        <List.Dropdown.Item key="current" title="Current Month" value="current" />
        <List.Dropdown.Item key="previous" title="Previous Month" value="previous" />
      </List.Dropdown>
      }
    >
      {filteredEntries.length === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Calendar}
          title="No Attendance Data"
          description="No attendance records found for the selected period"
        />
      ) : (
          filteredEntries.map((entry: AttendanceEntry) => {
            const icon = getStatusIcon(entry);
            const isCustomImage = typeof icon === "object";
            return (
              <List.Item
                key={entry.date}
                icon={
                  isCustomImage
                    ? icon
                    : { source: icon, tintColor: getStatusColor(entry) }
                }
            title={formatDate(entry.date, entry.dayOfWeek)}
            subtitle={
              entry.clockIn && entry.clockOut
                ? `${entry.clockIn} - ${entry.clockOut}`
                : entry.shiftTime || entry.holidayType || "No data"
            }
            accessories={[
              ...(entry.workingHours
                ? [
                    {
                      text: `Hours: ${entry.workingHours}`,
                      icon: Icon.Clock,
                    },
                  ]
                : []),
              ...(entry.rawStatus.length > 0
                ? [
                    {
                      text: formatStatus(entry),
                      icon: Icon.Tag,
                    },
                  ]
                : []),
            ]}
            detail={
              <List.Item.Detail
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label title="Date" text={formatDate(entry.date, entry.dayOfWeek)} />
                    {entry.holidayType && (
                      <List.Item.Detail.Metadata.Label title="Holiday Type" text={entry.holidayType} />
                    )}
                    {entry.shiftTime && (
                      <List.Item.Detail.Metadata.Label title="Shift Time" text={entry.shiftTime} />
                    )}
                    {entry.clockIn && (
                      <List.Item.Detail.Metadata.Label title="Clock In" text={entry.clockIn} />
                    )}
                    {entry.clockOut && (
                      <List.Item.Detail.Metadata.Label title="Clock Out" text={entry.clockOut} />
                    )}
                    {entry.workingHours && (
                      <List.Item.Detail.Metadata.Label title="Working Hours" text={entry.workingHours} />
                    )}
                    {entry.overtime && entry.overtime !== "00:00" && (
                      <List.Item.Detail.Metadata.Label title="Overtime" text={entry.overtime} />
                    )}
                    {entry.nightShift && entry.nightShift !== "00:00" && (
                      <List.Item.Detail.Metadata.Label title="Night Shift" text={entry.nightShift} />
                    )}
                    {entry.break && entry.break !== "00:00" && (
                      <List.Item.Detail.Metadata.Label title="Break" text={entry.break} />
                    )}
                    {entry.rawStatus.length > 0 && (
                      <>
                        <List.Item.Detail.Metadata.Separator />
                        <List.Item.Detail.Metadata.Label title="Status" text={formatStatus(entry)} />
                        {entry.statusTooltip && (
                          <List.Item.Detail.Metadata.Label title="Status Details" text={entry.statusTooltip} />
                        )}
                      </>
                    )}
                  </List.Item.Detail.Metadata>
                }
              />
            }
                actions={commonActions(entry)}
              />
            );
          })
      )}
    </List>
  );
}
