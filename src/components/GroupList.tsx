import React, { useState, useMemo, useCallback } from 'react';
import {
  Users,
  Search,
  Filter,
  Check,
  Clock,
  Tag,
  ChevronDown,
  ChevronUp,
  Smartphone,
} from 'lucide-react';
import { WhatsAppSession, useCampaign } from '../contexts/CampaignContext';

interface GroupListProps {
  session: WhatsAppSession;
}

const GroupList: React.FC<GroupListProps> = ({ session }) => {
  const { toggleGroupSelection, sessions } = useCampaign();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'participants' | 'activity'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  // Always use latest session state from context
  const currentSession = sessions.find((s) => s.id === session.id) || session;

  // Selected count
  const selectedCount = currentSession.groups.filter((g) => g.isSelected).length;

  // ✅ Optimized filtering + sorting with useMemo
  const filteredGroups = useMemo(() => {
    return currentSession.groups
      .filter((group) => {
        if (showSelectedOnly && !group.isSelected) return false;
        return group.name.toLowerCase().includes(searchTerm.toLowerCase());
      })
      .sort((a, b) => {
        let comparison = 0;
        switch (sortBy) {
          case 'name':
            comparison = a.name.localeCompare(b.name);
            break;
          case 'participants':
            comparison = a.participantCount - b.participantCount;
            break;
          case 'activity':
            comparison = (a.lastActivity || 0) - (b.lastActivity || 0);
            break;
        }
        return sortOrder === 'asc' ? comparison : -comparison;
      });
  }, [currentSession.groups, showSelectedOnly, searchTerm, sortBy, sortOrder]);

  // ✅ Optimized group toggle with useCallback
  const handleGroupToggle = useCallback((groupId: string) => {
    toggleGroupSelection(session.id, groupId);
  }, [toggleGroupSelection, session.id]);

  // ✅ Optimized sorting handler with useCallback
  const handleSort = useCallback((newSort: typeof sortBy) => {
    if (sortBy === newSort) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(newSort);
      setSortOrder('asc');
    }
  }, [sortBy, sortOrder]);

  // ✅ Optimized select all handler with useCallback
  const handleSelectAll = useCallback(() => {
    const shouldSelectAll = selectedCount !== currentSession.groups.length;
    
    currentSession.groups.forEach((group) => {
      if (shouldSelectAll && !group.isSelected) {
        handleGroupToggle(group.id);
      } else if (!shouldSelectAll && group.isSelected) {
        handleGroupToggle(group.id);
      }
    });
  }, [currentSession.groups, selectedCount, handleGroupToggle]);

  // ✅ Format activity with useCallback for stability
  const formatLastActivity = useCallback((timestamp?: number) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffHours < 168) return `${Math.floor(diffHours / 24)}d ago`;
    return date.toLocaleDateString();
  }, []);

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Smartphone className="h-6 w-6 text-blue-400" />
            <div>
              <h3 className="text-lg font-semibold text-white">
                {currentSession.phoneNumber || currentSession.id}
              </h3>
              <p className="text-sm text-gray-400">
                {currentSession.groups.length} groups • {selectedCount} selected
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-2 text-gray-400 hover:text-white transition-colors"
          >
            {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
          </button>
        </div>

        {/* Search & Filters */}
        {isExpanded && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search groups..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-gray-900 border border-gray-600 rounded-lg pl-10 pr-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <Filter className="h-5 w-5 text-gray-400" />
                <span className="text-sm text-gray-400">Sort by:</span>

                <div className="flex space-x-2">
                  {[
                    { key: 'name', label: 'Name' },
                    { key: 'participants', label: 'Size' },
                    { key: 'activity', label: 'Activity' },
                  ].map((option) => (
                    <button
                      key={option.key}
                      onClick={() => handleSort(option.key as typeof sortBy)}
                      className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                        sortBy === option.key
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      {option.label}
                      {sortBy === option.key && (
                        <span className="ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showSelectedOnly}
                  onChange={(e) => setShowSelectedOnly(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-400">Selected only</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Groups List */}
      {isExpanded && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-700">
            <thead className="bg-gray-800">
              <tr>
                <th className="px-6 py-3 text-left">
                  <input
                    type="checkbox"
                    className="rounded bg-gray-700 border-gray-600 cursor-pointer"
                    checked={
                      currentSession.groups.length > 0 &&
                      selectedCount === currentSession.groups.length
                    }
                    onChange={handleSelectAll} // ✅ Simplified using the callback
                  />
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer"
                  onClick={() => handleSort('name')}
                >
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">
                  Size
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">
                  Last Activity
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase">
                  Tags
                </th>
              </tr>
            </thead>
            <tbody className="bg-gray-800 divide-y divide-gray-700">
              {filteredGroups.map((group) => (
                <tr key={group.id} className="hover:bg-gray-700">
                  <td className="px-6 py-4">
                    <input
                      type="checkbox"
                      className="rounded bg-gray-700 border-gray-600 cursor-pointer"
                      checked={group.isSelected}
                      onChange={() => handleGroupToggle(group.id)}
                    />
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-300">{group.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-300">{group.participantCount}</td>
                  <td className="px-6 py-4 text-sm text-gray-300">
                    {formatLastActivity(group.lastActivity)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-300">
                    {group.tags && group.tags.length > 0
                      ? group.tags.map((t, i) => (
                          <span
                            key={i}
                            className="px-2 py-1 bg-gray-700 text-xs text-gray-300 rounded-full mr-1"
                          >
                            {t}
                          </span>
                        ))
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default GroupList;