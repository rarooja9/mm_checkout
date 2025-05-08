import React, { useState } from 'react';
// import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
// import { Button, ButtonVariant } from '../ui/button';

interface ShippingCalendarSelectorProps {
  calendarData: any;
  onSelectShippingOption: (option: any) => void;
  onSelectDeliveryDate: (date: Date) => void;
  selectedShippingOption: any;
  selectedShippingDate: Date | null;
  isLoading: boolean;
}

const ShippingCalendarSelector: React.FC<ShippingCalendarSelectorProps> = ({
  calendarData,
  onSelectShippingOption,
  onSelectDeliveryDate,
  selectedShippingOption,
  selectedShippingDate,
  isLoading
}) => {
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [showModal, setShowModal] = useState<boolean>(false);
  const [selectedDayMethods, setSelectedDayMethods] = useState<any[]>([]);
  const [selectedDateString, setSelectedDateString] = useState<string>("");
  const [selectedDayObject, setSelectedDayObject] = useState<Date | null>(null);


  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const getMethodsForDate = (date: Date) => {
    if (!calendarData) return [];

    const dateString = date.toISOString().split('T')[0];

    return calendarData.methods.filter((method: any) =>
      method.availableDates.some((availableDate: any) =>
        availableDate.iso === dateString
      )
    );
  };

  const openMethodsModal = (date: Date) => {
    const methods = getMethodsForDate(date);
    if (methods.length > 0) {
      setSelectedDayMethods(methods);
      setSelectedDateString(date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }));
      setSelectedDayObject(date);
      setShowModal(true);
    }
  };

  const handlePrevMonth = () => {
    setSelectedMonth(prevMonth => {
      if (prevMonth === 0) {
        setSelectedYear(prevYear => prevYear - 1);
        return 11;
      }
      return prevMonth - 1;
    });
  };

  const handleNextMonth = () => {
    setSelectedMonth(prevMonth => {
      if (prevMonth === 11) {
        setSelectedYear(prevYear => prevYear + 1);
        return 0;
      }
      return prevMonth + 1;
    });
  };

  const handleMethodSelect = (method: any) => {
    const option = {
      id: method.code,
      description: method.method,
      cost: method.totalCharges
    };

    onSelectShippingOption(option);

    // If we have a selected day, select that date
    if (selectedDayObject) {
      onSelectDeliveryDate(selectedDayObject);
    }

    setShowModal(false);
  };

  const renderCalendar = () => {
    if (isLoading) {
      return (
        <div className="tt-loading">
          <div>Loading calendar...</div>
        </div>
      );
    }

    const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
    const firstDayOfMonth = getFirstDayOfMonth(selectedYear, selectedMonth);

    const days = [];

    // Empty cells for days before the first of the month
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(<div key={`empty-${i}`} className="tt-day-empty"></div>);
    }

    // Calendar days
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(selectedYear, selectedMonth, day);
      const methods = getMethodsForDate(date);
      const isToday = date.toDateString() === new Date().toDateString();
      const isSelectedDate = selectedShippingDate &&
        date.getDate() === selectedShippingDate.getDate() &&
        date.getMonth() === selectedShippingDate.getMonth() &&
        date.getFullYear() === selectedShippingDate.getFullYear();

      days.push(
        <div
          key={day}
          className={`tt-day ${isToday ? 'tt-day-today' : ''} ${isSelectedDate ? 'tt-day-selected' : ''}`}
          onClick={() => openMethodsModal(date)}
        >
          <div className="tt-day-header">
            <span className="tt-day-number">{day}</span>
          </div>
          <div className="tt-method-list">
            {methods.length > 0 && (
              <div className="tt-method-item" onClick={(e) => {
                e.stopPropagation();
                openMethodsModal(date);
              }}>
                {methods.length} {methods.length === 1 ? 'option available' : 'options available'}
              </div>
            )}
          </div>
          {/* <div className="tt-method-list">
            {methods.slice(0, 2).map((method: any, idx: any) => (
              <div 
                key={idx} 
                className="tt-method-item"
                onClick={(e) => {
                  e.stopPropagation();
                  // Open modal instead of directly selecting the method
                  openMethodsModal(date);
                }}
              >
                {method.method}
              </div>
            ))}
            {methods.length > 2 && (
              <div className="tt-more-options">
                +{methods.length - 2} more...
              </div>
            )}
          </div> */}
        </div>
      );
    }

    return days;
  };

  return (
    <div className="shipping-calendar-container">
      <div className="tt-header">
        <div className="tt-title-container">
          <h3 className="tt-title">Select Estimated Delivery Date</h3>
        </div>
        <div className="tt-nav">
          <button
            onClick={handlePrevMonth}
            className="tt-nav-button"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          <span className="tt-month-year">
            {new Date(selectedYear, selectedMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </span>
          <button
            onClick={handleNextMonth}
            className="tt-nav-button"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      </div>

      <div className="tt-weekdays">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="tt-weekday">
            {day}
          </div>
        ))}
      </div>

      <div className="tt-grid">
        {renderCalendar()}
      </div>

      {selectedShippingOption && selectedShippingDate && (
        <div className="selected-shipping-container">
          <div className="selected-shipping-info">
            <div>
              <div className="selected-shipping-label">Selected Delivery Method:</div>
              <div className="selected-shipping-value">{selectedShippingOption.description} - ${selectedShippingOption.cost.toFixed(2)}</div>
            </div>
            <div>
              <div className="selected-shipping-label">Selected Estimated Delivery Date:</div>
              <div className="selected-shipping-value">
                {selectedShippingDate.toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal for showing shipping methods */}
      {showModal && (
        <div className="tt-modal-overlay">
          <div className="tt-modal">
            <div className="tt-modal-header">
              <h3 className="tt-modal-title">
               {selectedDateString} Estimated Delivery Options
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="tt-close-button"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="tt-modal-body">
              {selectedDayMethods.map((method, idx) => (
                <div
                  key={idx}
                  className={`tt-method-card ${selectedShippingOption && method.code === selectedShippingOption.id ? 'tt-method-card-selected' : ''
                    }`}
                  onClick={() => handleMethodSelect(method)}
                >
                  <div className="tt-method-card-header">
                    <span className="tt-method-name">{method.method}</span>
                    <span className="tt-method-price">
                      ${method.totalCharges.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="tt-modal-footer">
              <button
                onClick={() => setShowModal(false)}
                className="tt-button tt-button-secondary"
              >
                CANCEL
              </button>
              <button
                onClick={() => setShowModal(false)}
                className="tt-button tt-button-primary"
              >
                CONFIRM SELECTION
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShippingCalendarSelector;